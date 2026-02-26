// Подключаем необходимые модули
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const bcrypt = require('bcrypt');
const { Database } = require('sqlite3').verbose();

// Создаем экземпляр Express приложения
const app = express();
const PORT = process.env.PORT || 3000;

// Настройка middleware для обработки статических файлов (CSS, изображения)
app.use(express.static('public'));

// Настройка body-parser для обработки POST запросов в формате JSON и form-data
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Настройка сессий для хранения данных пользователя между запросами
app.use(session({
    secret: 'secret_key_for_exam', // Секретный ключ для шифрования сессии
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false, // Для разработки используем HTTP (не HTTPS)
        maxAge: 1000 * 60 * 60 * 24 // Сессия действует 24 часа
    }
}));

// Подключение к базе данных SQLite (light SQL): один файл database.db
const db = new Database('./database.db', (err) => {
    if (err) {
        console.error('Ошибка подключения к базе данных:', err.message);
        process.exit(1);
    }
    console.log('Подключено к базе данных SQLite');
    initializeDatabase().catch((e) => {
        console.error('Ошибка инициализации базы данных:', e.message);
        process.exit(1);
    });
});

function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) return reject(err);
            resolve(this);
        });
    });
}

function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });
}

function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) return reject(err);
            resolve(rows);
        });
    });
}

// Функция инициализации базы данных - создаем таблицы
async function initializeDatabase() {
    await dbRun(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'user',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    console.log('Таблица users создана или уже существует');
    await createDefaultAdmin();
}

// Функция создания администратора по умолчанию
async function createDefaultAdmin() {
    const adminUsername = 'admin';
    const adminPassword = 'admin123';

    const row = await dbGet('SELECT id FROM users WHERE username = ? LIMIT 1', [adminUsername]);
    if (row) return;

    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    await dbRun(
        'INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)',
        [adminUsername, 'admin@example.com', hashedPassword, 'admin']
    );
    console.log('Администратор создан успешно. Логин: admin, пароль: admin123');
}

// Middleware для проверки аутентификации пользователя
function isAuthenticated(req, res, next) {
    if (req.session.userId) {
        next(); // Пользователь авторизован, продолжаем
    } else {
        res.redirect('/login'); // Перенаправляем на страницу входа
    }
}

// Middleware для проверки прав администратора
function isAdmin(req, res, next) {
    if (req.session.userId && req.session.userRole === 'admin') {
        next(); // Пользователь - администратор, продолжаем
    } else {
        res.status(403).send('Доступ запрещен. Требуются права администратора.');
    }
}

// Маршруты приложения
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'register.html'));
});

app.get('/registered', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'registered.html'));
});

app.get('/dashboard', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

app.get('/admin', isAuthenticated, isAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'admin.html'));
});

// API для регистрации пользователя
app.post('/register', (req, res) => {
    const { username, email, password } = req.body;
    
    // Проверка обязательных полей
    if (!username || !email || !password) {
        return res.status(400).json({ error: 'Все поля обязательны для заполнения' });
    }
    
    // Хешируем пароль перед сохранением в базу
    bcrypt.hash(password, 10)
        .then(async (hashedPassword) => {
            try {
                const r = await dbRun(
                    'INSERT INTO users (username, email, password) VALUES (?, ?, ?)',
                    [username, email, hashedPassword]
                );
                res.status(201).json({ message: 'Пользователь успешно зарегистрирован', userId: r.lastID });
            } catch (err) {
                if (String(err.message || '').includes('UNIQUE constraint failed')) {
                    return res.status(400).json({ error: 'Пользователь с таким именем или email уже существует' });
                }
                return res.status(500).json({ error: 'Ошибка регистрации пользователя' });
            }
        })
        .catch(() => res.status(500).json({ error: 'Ошибка хеширования пароля' }));
});

// API для входа пользователя
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Логин и пароль обязательны' });
    }
    
    (async () => {
        try {
            const user = await dbGet('SELECT * FROM users WHERE username = ? LIMIT 1', [username]);
            if (!user) return res.status(401).json({ error: 'Неверный логин или пароль' });

            const ok = await bcrypt.compare(password, user.password);
            if (!ok) return res.status(401).json({ error: 'Неверный логин или пароль' });

            req.session.userId = user.id;
            req.session.username = user.username;
            req.session.userRole = user.role;

            return res.json({
                message: 'Вход выполнен успешно',
                user: { id: user.id, username: user.username, role: user.role }
            });
        } catch (err) {
            return res.status(500).json({ error: 'Ошибка поиска пользователя' });
        }
    })();
});

// API для выхода пользователя
app.post('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: 'Ошибка выхода из системы' });
        }
        res.json({ message: 'Выход выполнен успешно' });
    });
});

// API для получения списка пользователей (только для админа)
app.get('/api/users', isAuthenticated, isAdmin, (req, res) => {
    (async () => {
        try {
            const users = await dbAll('SELECT id, username, email, role, created_at FROM users ORDER BY created_at DESC');
            res.json(users);
        } catch (err) {
            res.status(500).json({ error: 'Ошибка получения списка пользователей' });
        }
    })();
});

// API для удаления пользователя (только для админа)
app.delete('/api/users/:id', isAuthenticated, isAdmin, (req, res) => {
    const userId = req.params.id;
    
    // Нельзя удалить самого себя
    if (parseInt(userId) === req.session.userId) {
        return res.status(400).json({ error: 'Нельзя удалить свою учетную запись' });
    }
    
    (async () => {
        try {
            const r = await dbRun('DELETE FROM users WHERE id = ?', [userId]);
            if (r.changes === 0) return res.status(404).json({ error: 'Пользователь не найден' });
            return res.json({ message: 'Пользователь успешно удален' });
        } catch (err) {
            return res.status(500).json({ error: 'Ошибка удаления пользователя' });
        }
    })();
});

// API для получения текущего пользователя
app.get('/api/current-user', (req, res) => {
    if (req.session.userId) {
        res.json({
            id: req.session.userId,
            username: req.session.username,
            role: req.session.userRole
        });
    } else {
        res.status(401).json({ error: 'Пользователь не авторизован' });
    }
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
    console.log(`Откройте http://localhost:${PORT} в браузере`);
    console.log('Администратор: логин - admin, пароль - admin123');
});

// Обработка закрытия приложения
process.on('SIGINT', () => {
    console.log('\nЗакрытие приложения...');
    db.close((err) => {
        if (err) console.error('Ошибка закрытия базы данных:', err.message);
        else console.log('База данных закрыта');
        process.exit(0);
    });
});

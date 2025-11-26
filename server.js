const express = require('express');
const path = require('path');
const session = require('express-session');
const mysql = require('mysql2'); // مكتبة MySQL
const app = express();
const port = 3000;

// ===================================================
// 1. إعداد الاتصال بقاعدة البيانات (DB CONFIG)
// ===================================================
const db = mysql.createConnection({
    host: 'localhost',      
    user: 'root',           
    password: '',           
    database: 'engineering_club' 
});

db.connect(err => {
    if (err) {
        console.error('❌ خطأ في الاتصال بقاعدة البيانات:', err.message);
        return; 
    }
    console.log('✅ تم الاتصال بقاعدة البيانات (MySQL) بنجاح!');
});

// ===================================================
// 2. الإعدادات الأساسية والوسائط (Middleware)
// ===================================================
app.use(express.urlencoded({ extended: true }));
app.use(express.json()); // لتمكين قراءة بيانات JSON من الـ API في لوحة الإدارة
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// إعداد نظام الجلسات (Session Middleware)
app.use(session({
    secret: 'your_secret_key_here_for_security', 
    resave: false, 
    saveUninitialized: false, 
    cookie: { 
        maxAge: 1000 * 60 * 60 * 24 
    }
}));

// دالة وسيطة لتمرير حالة تسجيل الدخول لكل القوالب
app.use((req, res, next) => {
    res.locals.isLoggedIn = !!req.session.isLoggedIn;
    res.locals.userId = req.session.userId || null;
    res.locals.userRole = req.session.userRole || 'guest';
    res.locals.isAdmin = req.session.userRole === 'admin';
    res.locals.isMember = req.session.userRole === 'member';
    next(); 
});


// 🔑 دالة وسيطة لحماية مسارات المسؤول (Admin Routes)
const isAdmin = (req, res, next) => {
    if (req.session.isLoggedIn && req.session.userRole === 'admin') {
        next(); 
    } else {
        res.status(403).render('error', { 
            pageTitle: 'منع الوصول',
            message: 'ليس لديك صلاحية الوصول لهذه الصفحة.',
        }); 
    }
};

// ===================================================
// 3. مسارات التحقق والتسجيل (Authentication Routes)
// ===================================================

// معالجة تسجيل الدخول (POST /login)
app.post('/login', (req, res) => {
    const { student_id, password } = req.body;
    
    // حالة المسؤول الثابت (admin)
    if (student_id === 'admin' && password === 'admin') {
        req.session.userId = student_id;
        req.session.isLoggedIn = true;
        req.session.userRole = 'admin';
        return res.redirect('/profile'); 
    }

    // التحقق من قاعدة البيانات وجلب 'role'
    const loginQuery = 'SELECT name, department, points, role FROM users WHERE student_id = ? AND password = ?';
    db.query(loginQuery, [student_id, password], (err, results) => {
        if (err || results.length === 0) {
            return res.render('login', { pageTitle: 'تسجيل الدخول', currentPage: 'login', error: 'الرقم الجامعي أو كلمة المرور غير صحيحة.' });
        }
        const user = results[0];
        req.session.userId = student_id;
        req.session.isLoggedIn = true;
        req.session.userRole = user.role;
        return res.redirect('/profile'); 
    });
});

// مسار تسجيل الخروج
app.get('/logout', (req, res) => {
    req.session.destroy(() => { res.redirect('/'); });
});


// ===================================================
// 4. مسار لوحة المشرف (GET /admin)
// ===================================================

app.get('/admin', isAdmin, (req, res) => {
    
    const statsQuery = `
        SELECT 
            (SELECT COUNT(*) FROM users) AS totalUsers,
            (SELECT COALESCE(AVG(points), 0) FROM users) AS averagePoints,
            (SELECT COUNT(*) FROM events) AS totalEvents
    `;
    
    const eventsQuery = 'SELECT id, name, points, date FROM events ORDER BY date DESC';
    const topUsersQuery = 'SELECT name, points, department FROM users ORDER BY points DESC LIMIT 5';
    
    db.query(statsQuery, (err, statsResults) => {
        if (err) { console.error('DB Error fetching stats:', err); }
        const stats = statsResults && statsResults.length > 0 ? statsResults[0] : { totalUsers: 0, totalEvents: 0, averagePoints: 0 };

        db.query(eventsQuery, (err, eventsResults) => {
            if (err) { console.error('DB Error fetching events:', err); eventsResults = []; }

            db.query(topUsersQuery, (err, topUsers) => {
                if (err) { console.error('DB Error fetching top users:', err); topUsers = []; }

                res.render('admin', {
                    pageTitle: 'لوحة المشرف',
                    currentPage: 'admin',
                    totalUsers: stats.totalUsers,
                    totalEvents: stats.totalEvents || 0,
                    averagePoints: Math.round(stats.averagePoints), 
                    events: eventsResults,
                    topUsers: topUsers
                });
            });
        });
    });
});


// ===================================================
// 5. مسارات API لإدارة المستخدمين والنقاط
// ===================================================

// جلب جميع المستخدمين
app.get('/api/admin/users', isAdmin, (req, res) => {
    const query = 'SELECT student_id, name, email, department, points, role FROM users ORDER BY points DESC';
    db.query(query, (err, results) => {
        if (err) { return res.status(500).json({ success: false, message: 'خطأ في جلب بيانات المستخدمين.' }); }
        res.json({ success: true, users: results });
    });
});

// تحديث دور المستخدم (admin/member/contestant)
app.post('/api/admin/user/:id/role', isAdmin, (req, res) => {
    const studentId = req.params.id;
    const { newRole } = req.body;

    if (!newRole || !['admin', 'member', 'contestant'].includes(newRole)) {
        return res.status(400).json({ success: false, message: 'دور غير صالح.' });
    }

    const updateQuery = 'UPDATE users SET role = ? WHERE student_id = ?';
    db.query(updateQuery, [newRole, studentId], (err, results) => {
        if (err) { return res.status(500).json({ success: false, message: 'فشل في تحديث الدور.' }); }
        res.json({ success: true, message: `تم تحديث دور المستخدم ${studentId} إلى ${newRole}.` });
    });
});

// تحديث نقاط المستخدم (زيادة/إنقاص)
app.post('/api/admin/user/:id/points', isAdmin, (req, res) => {
    const studentId = req.params.id;
    const { points, action } = req.body; // action: 'add' or 'subtract'
    const pointsValue = parseInt(points);

    if (isNaN(pointsValue) || pointsValue <= 0 || !action) {
        return res.status(400).json({ success: false, message: 'بيانات نقاط غير صالحة.' });
    }
    
    let updateQuery;
    if (action === 'add') {
        updateQuery = 'UPDATE users SET points = points + ? WHERE student_id = ?';
    } else if (action === 'subtract') {
        // نضمن أن النقاط لا تصبح سالبة
        updateQuery = 'UPDATE users SET points = CASE WHEN points - ? < 0 THEN 0 ELSE points - ? END WHERE student_id = ?';
    } else {
        return res.status(400).json({ success: false, message: 'إجراء غير معروف (Action).' });
    }

    const params = (action === 'subtract') ? [pointsValue, pointsValue, studentId] : [pointsValue, studentId];
    
    db.query(updateQuery, params, (err, results) => {
        if (err) { return res.status(500).json({ success: false, message: 'فشل في تحديث النقاط.' }); }
        res.json({ success: true, message: `تم تعديل نقاط المستخدم ${studentId} بنجاح.` });
    });
});


// ===================================================
// 6. مسارات API لإدارة الفعاليات
// ===================================================

// إنشاء فعالية
app.post('/api/events/create', isAdmin, (req, res) => {
    const { name, points, date, description } = req.body;
    const insertQuery = 'INSERT INTO events (name, points, date, description) VALUES (?, ?, ?, ?)';
    db.query(insertQuery, [name, points, date, description], (err, results) => {
        if (err) { return res.status(500).json({ success: false, message: 'فشل في إنشاء الفعالية.' }); }
        res.json({ success: true, message: 'تم إنشاء الفعالية بنجاح!', eventId: results.insertId });
    });
});

// حذف فعالية
app.delete('/api/events/delete/:id', isAdmin, (req, res) => {
    const eventId = req.params.id;
    const deleteQuery = 'DELETE FROM events WHERE id = ?';
    db.query(deleteQuery, [eventId], (err, results) => {
        if (err) { return res.status(500).json({ success: false, message: 'فشل في حذف الفعالية.' }); }
        res.json({ success: true, message: 'تم حذف الفعالية بنجاح.' });
    });
});

// ===================================================
// 7. مسارات API لإدارة الأخبار
// ===================================================

// جلب جميع الأخبار (تستخدمها لوحة الإدارة لتحميل القائمة)
app.get('/api/news/list', isAdmin, (req, res) => {
    const query = 'SELECT id, title, published_at FROM news ORDER BY published_at DESC';
    db.query(query, (err, results) => {
        if (err) { return res.status(500).json({ success: false, message: 'خطأ في جلب الأخبار.' }); }
        res.json({ success: true, news: results });
    });
});

// إنشاء خبر جديد
app.post('/api/news/create', isAdmin, (req, res) => {
    const { title, content } = req.body;
    const insertQuery = 'INSERT INTO news (title, content) VALUES (?, ?)';
    db.query(insertQuery, [title, content], (err, results) => {
        if (err) { return res.status(500).json({ success: false, message: 'فشل في إنشاء الخبر.' }); }
        res.json({ success: true, message: 'تم نشر الخبر بنجاح!', newsId: results.insertId });
    });
});

// حذف خبر
app.delete('/api/news/delete/:id', isAdmin, (req, res) => {
    const newsId = req.params.id;
    const deleteQuery = 'DELETE FROM news WHERE id = ?';
    db.query(deleteQuery, [newsId], (err, results) => {
        if (err) { return res.status(500).json({ success: false, message: 'فشل في حذف الخبر.' }); }
        res.json({ success: true, message: 'تم حذف الخبر بنجاح.' });
    });
});
// مسار الملف الشخصي (يقرأ البيانات من DB)
app.get('/profile', (req, res) => {
    if (!req.session.isLoggedIn) {
        console.log('Redirecting to login: User not logged in');
        return res.redirect('/login');
    }
    
    const userId = req.session.userId;
    const userRole = req.session.userRole; 
    
    // حالة المسؤول الثابت
    if (userRole === 'admin') {
        const userData = { name: 'المشرف', studentId: userId, department: 'إدارة عليا', email: 'admin@mu.edu.sa', points: 9999, committee: 'إدارة', avatarUrl: '/images/admin-avatar.png' };
        console.log(`Admin user ${userId} logged in successfully.`);
        return res.render('profile', { pageTitle: 'ملفي الشخصي', currentPage: 'profile', user: userData });
    }

    // جلب بيانات المستخدم من قاعدة البيانات
    const profileQuery = 'SELECT * FROM users WHERE student_id = ?';
    console.log(`Attempting to fetch data for user: ${userId}`); // سجل 1
    
    db.query(profileQuery, [userId], (err, results) => {
        
        if (err) {
            console.error('🚨 DB ERROR ON PROFILE FETCH:', err); // سجل 2: إذا كان هناك خطأ في الاستعلام
            return res.redirect('/logout');
        }
        
        if (results.length === 0) {
            console.error(`🚨 User ${userId} not found in DB after login.`); // سجل 3: إذا لم يتم العثور على بيانات
            return res.redirect('/logout');
        }

        // إذا نجح الاستعلام
        const dbUser = results[0];
        const userData = {
            name: dbUser.name,
            studentId: dbUser.student_id,
            department: dbUser.department,
            email: dbUser.email,
            points: dbUser.points || 0,
            committee: dbUser.committee,
            avatarUrl: '/img/default-avatar.png' 
        };
        
        console.log(`User ${userId} data fetched successfully. Rendering profile.`); // سجل 4
        
        res.render('profile', { pageTitle: 'ملفي الشخصي', currentPage: 'profile', user: userData });
    });
});
// ===================================================
// مسار لوحة تحكم المسؤول (GET /admin/dashboard)
// ===================================================
app.get('/admin/dashboard', (req, res) => {
    // 🔒 1. التحقق من تسجيل الدخول أولاً
    if (!req.session.isLoggedIn) {
        // إذا لم يكن مسجلاً، قم بتوجيهه إلى صفحة الدخول مع رسالة خطأ
        return res.redirect('/login?error=يجب تسجيل الدخول أولاً');
    }
    
    // 🔒 2. التحقق من أن المستخدم هو "مسؤول"
    if (req.session.userRole !== 'admin') {
        // إذا لم يكن مسؤولاً، قم بتوجيهه إلى صفحته الشخصية أو الصفحة الرئيسية
        // ويمكن عرض رسالة خطأ
        return res.status(403).redirect('/profile?error=لا تملك صلاحية الوصول');
    }

    // ✅ 3. إذا كان مسؤولاً: اعرض لوحة التحكم
    // يجب تمرير البيانات اللازمة لملف admin_dashboard.ejs
    const adminData = {
        totalUsers: 150, // بيانات افتراضية
        activeEvents: 5,
        pendingApprovals: 12
    };

    res.render('admin_dashboard', { 
        pageTitle: 'لوحة تحكم المسؤول', 
        currentPage: 'admin',
        isLoggedIn: true,
        isAdmin: true,
        data: adminData
    });
});
// ===================================================
// مسار إدارة المستخدمين (GET /admin/users)
// ===================================================
app.get('/admin/users', (req, res) => {
    // 🔒 1. التحقق من صلاحية المسؤول
    if (!req.session.isLoggedIn || req.session.userRole !== 'admin') {
        return res.status(403).redirect('/login?error=لا تملك صلاحية الوصول');
    }

    // 💡 2. جلب جميع المستخدمين من قاعدة البيانات
    const usersQuery = 'SELECT student_id, name, department, email, points, committee, role FROM users';
    
    db.query(usersQuery, (err, results) => {
        if (err) {
            console.error('🚨 DB Error fetching all users:', err);
            return res.status(500).send('خطأ في استرجاع بيانات المستخدمين.');
        }

        // ✅ 3. اعرض صفحة إدارة المستخدمين مع البيانات
        res.render('admin_users', { 
            pageTitle: 'إدارة المستخدمين', 
            currentPage: 'admin',
            users: results // تمرير قائمة المستخدمين إلى EJS
        });
    });
});

// ===================================================
// 8. تشغيل الخادم
// ===================================================

// مسارات أخرى (الرئيسية، تسجيل الدخول، إلخ) يجب أن تكون موجودة هنا ليعمل التطبيق بشكل كامل...
app.get('/', (req, res) => { res.render('index', { pageTitle: 'الرئيسية', currentPage: 'home' }); });
app.get('/login', (req, res) => { res.render('login', { pageTitle: 'تسجيل الدخول', currentPage: 'login', error: null }); });
app.get('/register', (req, res) => { res.render('register', { pageTitle: 'تسجيل عضوية', currentPage: 'register', error: null }); });
app.get('/profile', (req, res) => { /* منطق عرض الملف الشخصي... */ }); 
// ... وغيرها من المسارات

app.listen(port, () => {
    console.log(`🚀 النادي الهندسي يعمل على http://localhost:${port}`);
});
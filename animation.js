/*
 * ====================================
 * ⚙️  كود توليد الدوائر المتحركة (CSS Animation)
 * ====================================
 */
document.addEventListener('DOMContentLoaded', () => {
    const section = document.querySelector('.animated-circles-container');
    if (!section) return;

    const count = 10; // عدد الدوائر
    const ul = document.createElement('ul');
    ul.className = 'circles';

    // توليد عناصر الدوائر
    for (let i = 0; i < count; i++) {
        const li = document.createElement('li');
        // توليد حجم عشوائي (بين 20px و 150px)
        const size = Math.random() * 130 + 20; 
        li.style.width = `${size}px`;
        li.style.height = `${size}px`;
        // توليد موقع عشوائي أفقي
        li.style.left = `${Math.random() * 100}%`;
        // توليد سرعة وزمن حركة عشوائي
        li.style.animationDuration = `${Math.random() * 10 + 10}s`; // 10 إلى 20 ثانية
        li.style.animationDelay = `${Math.random() * 5}s`;
        
        ul.appendChild(li);
    }
    
    section.appendChild(ul);
});
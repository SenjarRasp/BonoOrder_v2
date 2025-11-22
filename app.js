class RestaurantOrderApp {
    constructor() {
        this.basePath = window.location.pathname.includes('/BonoOrder/') ? '/BonoOrder/' : '/';
        this.apiUrl = 'https://script.google.com/macros/s/AKfycbxAbxAVeOE5yHEYLMfSMEnMnfV49NnuZBQRHaa6rLSJsvm5IQ1DvL6ge6DkolpTehkirg/exec';
        this.currentUser = null;
        this.currentScreen = 'login';
        this.ordersHistory = [];
        this.availableTemplates = [];
        this.currentGroupBy = 'supplier';
        this.currentProducts = [];
        this.currentTemplateName = '';
        this.currentOrderData = {};
        this.isAdmin = false;
        this.isSuperAdmin = false;
        this.init();
    }

    init() {
        this.renderScreen('login');
        this.setupEventListeners();
        this.hideLoading();
    }

    saveCurrentFormData() {
        const formData = {};
        document.querySelectorAll('.quantity-input').forEach(input => {
            const key = `${input.dataset.productName}|${input.dataset.supplier}`;
            if (!formData[key]) formData[key] = {};
            formData[key].quantity = parseInt(input.value) || 0;
        });
        document.querySelectorAll('.comment-input').forEach(input => {
            const key = `${input.dataset.productName}|${input.dataset.supplier}`;
            if (!formData[key]) formData[key] = {};
            formData[key].comment = input.value;
        });
        this.currentOrderData = { ...this.currentOrderData, ...formData };
    }

    restoreFormData() {
        Object.keys(this.currentOrderData).forEach(key => {
            const [productName, supplier] = key.split('|');
            const data = this.currentOrderData[key];
            const quantityInput = document.querySelector(`.quantity-input[data-product-name="${productName}"][data-supplier="${supplier}"]`);
            const commentInput = document.querySelector(`.comment-input[data-product-name="${productName}"][data-supplier="${supplier}"]`);
            if (quantityInput && data.quantity) quantityInput.value = data.quantity;
            if (commentInput && data.comment) commentInput.value = data.comment;
        });
    }

    changeGroupBy(groupBy) {
        this.saveCurrentFormData();
        this.currentGroupBy = groupBy;
        this.renderScreen('order_creation', {
            templateName: this.currentTemplateName,
            products: this.currentProducts
        });
    }

    showLoading(text = 'Загрузка...') {
        const overlay = document.getElementById('loadingOverlay');
        const loadingText = document.getElementById('loadingText');
        if (overlay && loadingText) {
            loadingText.textContent = text;
            overlay.classList.add('active');
        }
    }

    hideLoading() {
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) overlay.classList.remove('active');
        this.enableUI();
    }

    disableUI() {
        document.querySelectorAll('.action-card, .template-card, .btn, .back-btn').forEach(el => {
            el.classList.add('disabled', 'loading');
        });
    }

    enableUI() {
        document.querySelectorAll('.action-card, .template-card, .btn, .back-btn').forEach(el => {
            el.classList.remove('disabled', 'loading');
        });
    }

    showSuccess(message = 'Успешно!') {
        this.showLoading(message);
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) {
            overlay.innerHTML = `
                <div class="loading-text">${message}</div>
                <div class="success-checkmark">
                    <div class="check-icon">
                        <span class="icon-line line-tip"></span>
                        <span class="icon-line line-long"></span>
                        <div class="icon-circle"></div>
                        <div class="icon-fix"></div>
                    </div>
                </div>
            `;
            setTimeout(() => this.hideLoading(), 2000);
        }
    }

    animateCardClick(cardElement, callback) {
        cardElement.classList.add('loading');
        const loadingBar = document.createElement('div');
        loadingBar.className = 'card-loading-bar';
        cardElement.appendChild(loadingBar);
        cardElement.style.transform = 'scale(0.95)';
        setTimeout(() => callback && callback(), 150);
        setTimeout(() => this.resetCardAnimation(cardElement), 1000);
    }

    resetCardAnimation(cardElement) {
        cardElement.classList.remove('loading');
        cardElement.style.transform = '';
        const loadingBar = cardElement.querySelector('.card-loading-bar');
        if (loadingBar) loadingBar.remove();
    }

    async handleLogin(phone, password) {
        try {
            this.showLoading('Вход в систему...');
            const loginResult = await this.apiCall('login', { phone, password });
            this.currentUser = loginResult.user;
            const adminValue = this.currentUser.isAdmin;
            const adminStatus = typeof adminValue === 'boolean' ? (adminValue ? 'TRUE' : 'FALSE') : String(adminValue).toUpperCase();
            this.isAdmin = adminStatus === 'TRUE' || adminStatus === 'SUPER';
            this.isSuperAdmin = adminStatus === 'SUPER';
            this.showSuccess(`Добро пожаловать, ${this.currentUser.name}!`);
            setTimeout(() => this.renderScreen('main'), 2000);
        } catch (error) {
            this.hideLoading();
            this.showNotification('error', error.message);
        }
    }

    async loadUserTemplates() {
        try {
            this.showLoading('Загрузка шаблонов...');
            const result = await this.apiCall('get_user_templates', { userPhone: this.currentUser.phone });
            this.availableTemplates = result.templates;
            this.hideLoading();
            this.renderScreen('template_selection');
        } catch (error) {
            this.hideLoading();
            this.showNotification('error', 'Ошибка загрузки шаблонов: ' + error.message);
        }
    }

    async loadTemplateProducts(templateName) {
        try {
            this.showLoading('Загрузка товаров...');
            const result = await this.apiCall('get_products_by_template', { templateName, userPhone: this.currentUser.phone });
            this.hideLoading();
            this.currentProducts = result.products;
            this.currentTemplateName = templateName;
            this.renderScreen('order_creation', { templateName, products: result.products });
        } catch (error) {
            this.hideLoading();
            this.showNotification('error', 'Ошибка загрузки товаров: ' + error.message);
        }
    }

    async submitOrder(templateName) {
        if (!this.currentUser?.phone) {
            this.showNotification('error', 'Ошибка: пользователь не авторизован');
            this.renderScreen('login');
            return;
        }
        try {
            this.saveCurrentFormData();
            this.disableUI();
            const items = this.collectOrderItems();
            if (items.length === 0) {
                this.enableUI();
                this.showNotification('error', 'Добавьте хотя бы один товар в заявку');
                return;
            }
            this.showLoading('Отправка заявки поставщикам...');
            const requestData = {
                userPhone: this.currentUser.phone,
                userName: this.currentUser.name,
                department: this.currentUser.department,
                templateName,
                items
            };
            const result = await this.apiCall('create_order', requestData);
            this.ordersHistory.unshift({
                order_id: result.order_id,
                date: result.timestamp || new Date().toISOString(),
                template: templateName,
                status: 'success',
                items_count: items.length
            });
            this.currentOrderData = {};
            this.showSuccess(`Заявка ${result.order_id} отправлена!`);
            setTimeout(() => this.renderScreen('main'), 2000);
        } catch (error) {
            this.hideLoading();
            this.showNotification('error', 'Ошибка отправки: ' + error.message);
        }
    }

    async apiCall(action, data = {}) {
        this.disableUI();
        try {
            await new Promise(resolve => setTimeout(resolve, 500));
            const url = new URL(this.apiUrl);
            url.searchParams.set('action', action);
            url.searchParams.set('data', JSON.stringify(data));
            const response = await fetch(url.toString());
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const result = await response.json();
            if (result.status === 'success') return result.data;
            throw new Error(result.message || 'Unknown API error');
        } catch (error) {
            if (error.message.includes('Failed to fetch') || error.message.includes('CORS') || error.message.includes('status: 0')) {
                return this.apiCallJSONP(action, data);
            }
            throw new Error('Ошибка соединения: ' + error.message);
        } finally {
            this.hideLoading();
        }
    }

    collectOrderItems() {
        const items = [];
        Object.keys(this.currentOrderData).forEach(key => {
            const [productName, supplier] = key.split('|');
            const data = this.currentOrderData[key];
            if (data.quantity > 0) {
                const product = this.currentProducts.find(p => p.name === productName && p.supplier === supplier);
                if (product) {
                    items.push({
                        product_name: productName,
                        quantity: data.quantity,
                        unit: product.unit,
                        supplier,
                        comment: data.comment || ''
                    });
                }
            }
        });
        return items;
    }

    async loadOrderHistory() {
        if (this._loadingHistory) return;
        this._loadingHistory = true;
        try {
            this.disableUI();
            this.showLoading('Загрузка истории...');
            await new Promise(resolve => setTimeout(resolve, 1500));
            const history = await this.apiCall('get_order_history', { userPhone: this.currentUser.phone });
            this.ordersHistory = Array.isArray(history) ? history : [];
            this.hideLoading();
            this.renderScreen('order_history');
        } catch (error) {
            this.hideLoading();
            this.showNotification('error', 'Ошибка загрузки истории: ' + error.message);
            this.ordersHistory = [];
            this.renderScreen('order_history');
        } finally {
            this._loadingHistory = false;
        }
    }

    renderScreen(screenName, data = null) {
        this.currentScreen = screenName;
        const app = document.getElementById('app');
        const isBackNavigation = screenName === 'main' || screenName === 'template_selection';
        const exitAnimation = isBackNavigation ? 'screen-exit-back' : 'screen-exit';
        if (app.children.length > 0) app.children[0].classList.add(exitAnimation);
        setTimeout(() => {
            let screenHTML = '';
            switch(screenName) {
                case 'login': screenHTML = this.renderLoginScreen(); break;
                case 'main': screenHTML = this.renderMainScreen(); break;
                case 'template_selection': screenHTML = this.renderTemplateSelectionScreen(); break;
                case 'add_product': screenHTML = this.renderAddProductScreen(data); break;
                case 'add_supplier': screenHTML = this.renderAddSupplierScreen(); break;
                case 'delete_product': screenHTML = this.renderDeleteProductScreen(data); break;
                case 'delete_supplier': screenHTML = this.renderDeleteSupplierScreen(data); break;
                case 'manage_templates': screenHTML = this.renderTemplatesManagementScreen(data); break;
                case 'manage_users': screenHTML = this.renderUsersManagementScreen(data); break;
                case 'order_creation': screenHTML = this.renderOrderCreationScreen(data); break;
                case 'order_history': screenHTML = this.renderOrderHistoryScreen(); break;
            }
            app.innerHTML = screenHTML;
            if (screenName === 'order_creation') this.initToggleSwitch();
            if (screenName === 'delete_product') setTimeout(() => this.setupProductSelection(), 100);
            if (screenName === 'order_history') setTimeout(() => this.setupModalClose(), 100);
        }, 300);
    }

    renderLoginScreen() {
        return `
            <div class="login-screen">
                <div class="logo"><img src="${getAppLogo()}" alt="Restaurant Orders" style="width: 80px; height: 80px;"></div>
                <h1>Bono заявки</h1>
                <p style="color: #7f8c8d; margin-bottom: 30px; text-align: center;">Система управления заявками</p>
                <form id="loginForm" class="form">
                    <div class="input-group"><input type="tel" id="phone" placeholder="Телефон" required></div>
                    <div class="input-group"><input type="password" id="password" placeholder="Пароль" required></div>
                    <button type="submit" class="btn primary" style="width: 100%;">Войти</button>
                </form>
                <div id="loginStatus" class="status"></div>
            </div>`;
    }

    renderMainScreen() {
        const adminActions = this.isAdmin ? `
            <div class="action-card" onclick="app.handleMainAction('add_product')"><div class="action-content"><div class="action-icon">➕</div><h3>Добавить товар</h3><p>Добавить новый товар в базу</p></div></div>
            <div class="action-card" onclick="app.handleMainAction('add_supplier')"><div class="action-content"><div class="action-icon">🏢</div><h3>Добавить поставщика</h3><p>Добавить нового поставщика</p></div></div>
            <div class="action-card" onclick="app.handleMainAction('delete_product')"><div class="action-content"><div class="action-icon">🗑️</div><h3>Удалить товар</h3><p>Удалить товары из базы</p></div></div>
            <div class="action-card" onclick="app.handleMainAction('delete_supplier')"><div class="action-content"><div class="action-icon">❌</div><h3>Удалить поставщика</h3><p>Удалить поставщиков из базы</p></div></div>
        ` : '';
        const superAdminActions = this.isSuperAdmin ? `
            <div class="action-card" onclick="app.handleMainAction('manage_templates')"><div class="action-content"><div class="action-icon">⚙️</div><h3>Настроить шаблоны</h3><p>Управление шаблонами заявок</p></div></div>
            <div class="action-card" onclick="app.handleMainAction('manage_users')"><div class="action-content"><div class="action-icon">👥</div><h3>Пользователи</h3><p>Управление пользователями</p></div></div>
        ` : '';
        return `
            <div class="main-screen screen-transition">
                <header class="header">
                    <h1>Главная</h1>
                    <div class="user-info">${this.currentUser.department} • ${this.currentUser.position}${this.isAdmin ? ' • 👑 Админ' : ''}${this.isSuperAdmin ? ' • 👑 Супер-админ' : ''}</div>
                </header>
                <div class="actions-grid">
                    <div class="action-card" onclick="app.handleMainAction('new_order')"><div class="action-content"><div class="action-icon">📋</div><h3>Новая заявка</h3><p>Создать заказ поставщикам</p></div></div>
                    <div class="action-card" onclick="app.handleMainAction('history')"><div class="action-content"><div class="action-icon">📊</div><h3>История заявок</h3><p>Посмотреть отправленные</p></div></div>
                    ${adminActions}${superAdminActions}
                    <div class="action-card" onclick="app.handleMainAction('logout')"><div class="action-content"><div class="action-icon">🚪</div><h3>Выйти</h3><p>Завершить сеанс</p></div></div>
                </div>
                <div class="notifications">
                    <h3>👋 Добро пожаловать, ${this.currentUser.name}!</h3>
                    <p>Доступные шаблоны: ${this.currentUser.templates.join(', ')}</p>
                </div>
            </div>`;
    }

    handleMainAction(action) {
        const card = event.currentTarget;
        this.disableUI();
        this.animateCardClick(card, () => {
            switch(action) {
                case 'new_order': this.loadUserTemplates(); break;
                case 'history': this.loadOrderHistory(); break;
                case 'add_product': this.showAddProductScreen(); break;
                case 'add_supplier': this.showAddSupplierScreen(); break;
                case 'delete_product': this.showDeleteProductScreen(); break;
                case 'delete_supplier': this.showDeleteSupplierScreen(); break;
                case 'manage_templates': this.showTemplatesManagementScreen(); break;
                case 'manage_users': this.showUsersManagementScreen(); break;
                case 'logout': this.showLoading('Выход из системы...'); setTimeout(() => this.logout(), 500); break;
            }
        });
    }

    renderTemplateSelectionScreen() {
        let templatesHtml = '';
        if (this.availableTemplates.length === 0) {
            templatesHtml = `<div style="text-align: center; padding: 40px; color: #7f8c8d;"><div style="font-size: 3rem; margin-bottom: 20px;">📭</div><h3>Шаблоны не найдены</h3><p>Обратитесь к администратору для настройки доступов</p></div>`;
        } else {
            templatesHtml = '<div class="templates-grid">';
            this.availableTemplates.forEach(template => {
                templatesHtml += `<div class="template-card" onclick="app.handleTemplateSelect('${template.name}', this)"><div class="template-content"><div class="template-icon">${template.type === 'daily' ? '📅' : '📦'}</div><h3>${template.name}</h3><p>${template.type === 'daily' ? 'Ежедневная закупка' : 'Еженедельная закупка'}</p></div></div>`;
            });
            templatesHtml += '</div>';
        }
        return `<div class="template-screen screen-transition"><header class="header"><button class="back-btn" onclick="app.handleBackButton()">◀️ Назад</button><h1>Выбор шаблона</h1></header>${templatesHtml}</div>`;
    }

    handleTemplateSelect(templateName, cardElement) {
        cardElement.style.transform = 'scale(0.98)';
        this.disableUI();
        setTimeout(() => this.loadTemplateProducts(templateName), 150);
    }

    handleBackButton() {
        const button = event.currentTarget;
        button.style.transform = 'translateX(-3px)';
        this.disableUI();
        setTimeout(() => { button.style.transform = ''; this.renderScreen('main'); }, 300);
    }

    logout() {
        this.currentUser = null;
        this.ordersHistory = [];
        this.availableTemplates = [];
        this.enableUI();
        this.renderScreen('login');
    }

    setupEventListeners() {
        document.addEventListener('submit', (e) => {
            if (e.target.id === 'loginForm') {
                e.preventDefault();
                this.handleLogin(document.getElementById('phone').value, document.getElementById('password').value);
            }
            if (e.target.id === 'addProductForm') {
                e.preventDefault();
                this.handleAddProduct();
            }
            if (e.target.id === 'addSupplierForm') {
                e.preventDefault();
                this.handleAddSupplier();
            }
        });
    }
}

const app = new RestaurantOrderApp();

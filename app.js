class RestaurantOrderApp {
    constructor() {
        this.basePath = window.location.pathname.includes('/BonoOrder_v2/') 
            ? '/BonoOrder_v2/' 
            : '/';
        
        this.apiUrl = 'https://script.google.com/macros/s/AKfycbzpAuZ1AU--_zED2-k_wTHeEqXxdXG8WDko7rhD2HihX6rlXoDAlL0LxsPMyHwQpqN0Qw/exec';
        this.currentUser = null;
        this.currentScreen = 'login';
        this.ordersHistory = [];
        this.availableTemplates = [];
        this.currentGroupBy = 'supplier'; // 'supplier' или 'tags'
        this.currentProducts = [];
        this.currentTemplateName = '';
        this.currentOrderData = {}; // Для хранения введённых данных
        this.isAdmin = false;
        this.isSuperAdmin = false;
        this.cacheVersions = {};
        this._submitting = false; // для блокировки двойной отправки
        this.init();
    }

    init() {
        this.renderScreen('login');
        this.setupEventListeners();
        this.hideLoading(); // Убедимся, что загрузка скрыта при старте
        document.addEventListener('input', (e) => {
          if (e.target.classList.contains('quantity-input') || e.target.classList.contains('comment-input')) {
            const productName = e.target.dataset.productName;
            const supplier = e.target.dataset.supplier;
            const key = `${productName}|${supplier}`;
            if (!this.currentOrderData[key]) this.currentOrderData[key] = {};
            if (e.target.classList.contains('quantity-input')) {
              this.currentOrderData[key].quantity = parseInt(e.target.value) || 0;
            } else {
              this.currentOrderData[key].comment = e.target.value;
            }
          }
        });
    }

    loadCachedVersions() {
        const versions = localStorage.getItem('cache_versions');
        return versions ? JSON.parse(versions) : {};
    }
    
    saveCachedVersions(versions) {
        localStorage.setItem('cache_versions', JSON.stringify(versions));
    }
    
    getCachedData(sheetName) {
        const data = localStorage.getItem(`cache_${sheetName}`);
        return data ? JSON.parse(data) : null;
    }
    
    saveCachedData(sheetName, data) {
        localStorage.setItem(`cache_${sheetName}`, JSON.stringify(data));
    }
    
    async syncData(force = false) {
      try {
        const serverVersions = await this.apiCall('get_versions');
        const cachedVersions = this.loadCachedVersions();
        
        const sheetsToLoad = [];
        for (let sheet in serverVersions) {
          if (force || serverVersions[sheet] !== cachedVersions[sheet]) {
            sheetsToLoad.push(sheet);
          }
        }
        
        if (sheetsToLoad.length === 0) return;
        
        this.showLoading('Обновление данных...');
        const promises = sheetsToLoad.map(sheet => {
          switch(sheet) {
            case 'Products': return this.apiCall('get_all_products');
            case 'Suppliers': return this.apiCall('get_all_suppliers');
            case 'Templates': return this.apiCall('get_all_templates');
            case 'Users': return this.apiCall('get_all_users');
            default: return null;
          }
        });
        const results = await Promise.all(promises.filter(p => p));
        
        sheetsToLoad.forEach((sheet, index) => {
          if (results[index]) {
            this.saveCachedData(sheet, results[index]);
          }
        });
        
        this.saveCachedVersions(serverVersions);
        this.hideLoading();
      } catch (error) {
        console.error('Sync error:', error);
        this.hideLoading();
      }
    }

    // Метод для восстановления данных в форме
    restoreFormData() {
        Object.keys(this.currentOrderData).forEach(key => {
            const [productName, supplier] = key.split('|');
            const data = this.currentOrderData[key];
            
            // Восстанавливаем количество
            const quantityInput = document.querySelector(`.quantity-input[data-product-name="${productName}"][data-supplier="${supplier}"]`);
            if (quantityInput && data.quantity) {
                quantityInput.value = data.quantity;
            }
            
            // Восстанавливаем комментарий
            const commentInput = document.querySelector(`.comment-input[data-product-name="${productName}"][data-supplier="${supplier}"]`);
            if (commentInput && data.comment) {
                commentInput.value = data.comment;
            }
        });
    }
    
    // Метод для изменения способа группировки
    changeGroupBy(groupBy) {
        this.saveCurrentFormData();
        this.currentGroupBy = groupBy;
        // Перерисовываем экран с новым способом группировки
        this.renderScreen('order_creation', {
            templateName: this.currentTemplateName,
            products: this.currentProducts
        });
    }
     // Показать анимацию загрузки
    showLoading(text = 'Загрузка...') {
        const overlay = document.getElementById('loadingOverlay');
        const loadingText = document.getElementById('loadingText');
        
        if (overlay && loadingText) {
            loadingText.textContent = text;
            overlay.classList.add('active');
        }
    }

    // Скрыть анимацию загрузки
    hideLoading() {
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) {
            overlay.classList.remove('active');
        }
        this.enableUI(); // Всегда разблокируем UI при скрытии загрузки
    }

    // Блокировка всех интерактивных элементов
    disableUI() {
        const interactiveElements = document.querySelectorAll('.action-card, .template-card, .btn, .back-btn');
        interactiveElements.forEach(element => {
            element.classList.add('disabled', 'loading');
        });
    }

    // Разблокировка всех интерактивных элементов
    enableUI() {
        const interactiveElements = document.querySelectorAll('.action-card, .template-card, .btn, .back-btn');
        interactiveElements.forEach(element => {
            element.classList.remove('disabled', 'loading');
        });
    }
    
    // Показать успешную анимацию
    showSuccess(message = 'Успешно!') {
        this.showLoading(message);
        const overlay = document.getElementById('loadingOverlay');
        const loadingText = document.getElementById('loadingText');
        
        if (overlay && loadingText) {
            // Меняем анимацию на успех
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
            
            // Автоматически скрываем через 2 секунды
            setTimeout(() => {
                this.hideLoading();
            }, 2000);
        }
    }

    // Анимация нажатия на карточку
    animateCardClick(cardElement, callback) {
        // Добавляем класс нажатия
        cardElement.classList.add('loading');
        
        // Создаем элемент прогресс-бара
        const loadingBar = document.createElement('div');
        loadingBar.className = 'card-loading-bar';
        cardElement.appendChild(loadingBar);
        
        // Анимация нажатия
        cardElement.style.transform = 'scale(0.95)';
        
        // Запускаем callback после короткой задержки для анимации
        setTimeout(() => {
            if (callback) {
                callback();
            }
        }, 150);
        
        // Убираем анимацию через 1 секунду (на случай долгой загрузки)
        setTimeout(() => {
            this.resetCardAnimation(cardElement);
        }, 1000);
    }

    // Сброс анимации карточки
    resetCardAnimation(cardElement) {
        cardElement.classList.remove('loading');
        cardElement.style.transform = '';
        const loadingBar = cardElement.querySelector('.card-loading-bar');
        if (loadingBar) {
            loadingBar.remove();
        }
    }

    // Показать успех на карточке
    showCardSuccess(cardElement) {
        cardElement.classList.add('success');
        
        const successCheck = document.createElement('div');
        successCheck.className = 'success-check';
        successCheck.innerHTML = '✓';
        cardElement.appendChild(successCheck);
        
        setTimeout(() => {
            cardElement.classList.remove('success');
            if (successCheck.parentNode === cardElement) {
                cardElement.removeChild(successCheck);
            }
        }, 2000);
    }
    
    // Обработка логина
    async handleLogin(phone, password) {
        try {
            this.showLoading('Вход в систему...');
            const loginResult = await this.apiCall('login', { phone, password });
           
           this.currentUser = {
                phone: loginResult.user.phone,
                name: loginResult.user.name,
                department: loginResult.user.department,
                position: loginResult.user.position,
                templates: loginResult.user.templates,
                isAdmin: loginResult.user.isAdmin || false
            };
            
            // после установки this.currentUser
            await this.syncData();
            this.showSuccess(`Добро пожаловать, ${this.currentUser.name}!`);
            setTimeout(() => this.renderScreen('main'), 2000);
            // Преобразуем admin значение в строку и приводим к верхнему регистру
            const adminValue = String(this.currentUser.isAdmin).trim().toUpperCase();
            console.log('Admin value normalized:', adminValue);
            
            // Проверяем права одним условием
            this.isAdmin = (adminValue === 'TRUE' || adminValue === 'SUPER' || adminValue === '1' || adminValue === 'YES');
            this.isSuperAdmin = (adminValue === 'SUPER');
            
            console.log('Login debug:', {
                original: this.currentUser.isAdmin,
                normalized: adminValue,
                isAdmin: this.isAdmin,
                isSuperAdmin: this.isSuperAdmin
            });
        
            this.showSuccess(`Добро пожаловать, ${this.currentUser.name}!`);
            setTimeout(() => {
                this.renderScreen('main');
            }, 2000);
            
        } catch (error) {
            this.hideLoading();
            this.showNotification('error', error.message);
        }
    }

    // Загрузка доступных шаблонов
    async loadUserTemplates() {
        try {
            this.showLoading('Загрузка шаблонов...');
            const result = await this.apiCall('get_user_templates', {
                userPhone: this.currentUser.phone
            });
            
            this.availableTemplates = result.templates;
            this.hideLoading();
            this.enableUI(); // Разблокируем UI после загрузки
            this.renderScreen('template_selection');
        } catch (error) {
            this.hideLoading();
            this.enableUI(); // Разблокируем UI при ошибке
            this.showNotification('error', 'Ошибка загрузки шаблонов: ' + error.message);
        }
    }

    // Загрузка товаров по шаблону
    async loadTemplateProducts(templateName) {
        try {
            this.showLoading('Загрузка товаров...');
            const result = await this.apiCall('get_products_by_template', {
                templateName: templateName,
                userPhone: this.currentUser.phone
            });
            
            this.hideLoading();
            this.enableUI();
            
            // Сохраняем товары и название шаблона для перерисовки
            this.currentProducts = result.products;
            this.currentTemplateName = templateName;
            
            this.renderScreen('order_creation', { 
                templateName: templateName,
                products: result.products 
            });
        } catch (error) {
            this.hideLoading();
            this.enableUI();
            this.showNotification('error', 'Ошибка загрузки товаров: ' + error.message);
        }
    }

    // Отправка заявки
    async submitOrder(templateName) {
        if (this._submitting) return;
        this._submitting = true;
        if (!this.currentUser || !this.currentUser.phone) {
            this.showNotification('error', 'Ошибка: пользователь не авторизован');
            this.renderScreen('login');
            return;
        }
        
        try {
            // СОХРАНЯЕМ ДАННЫЕ ПЕРЕД ОТПРАВКОЙ
            this.saveCurrentFormData();
            this.disableUI(); // Блокируем UI перед отправкой
            const items = this.collectOrderItems();
            if (items.length === 0) {
                this.enableUI(); // Разблокируем если нет товаров
                this.showNotification('error', 'Добавьте хотя бы один товар в заявку');
                return;
            }
            
            this.showLoading('Отправка заявки поставщикам...');
            
            const requestData = {
                userPhone: this.currentUser.phone,
                userName: this.currentUser.name,
                department: this.currentUser.department,
                templateName: templateName,
                items: items
            };
            
            const result = await this.apiCall('create_order', requestData);
            
            this.ordersHistory.unshift({
                order_id: result.order_id,
                date: result.timestamp || new Date().toISOString(),
                template: templateName,
                status: 'success',
                items_count: items.length
            });
            
            // Очищаем сохранённые данные после успешной отправки
            this.currentOrderData = {};
            
            this.showSuccess(`Заявка ${result.order_id} отправлена!`);
            this.enableUI(); // Разблокируем после успешной отправки
            
            setTimeout(() => {
                this.renderScreen('main');
            }, 2000);
            
        } catch (error) {
            this.hideLoading();
            this.enableUI(); // Разблокируем при ошибке
            this.showNotification('error', 'Ошибка отправки: ' + error.message);
        }
        finally {
            this._submitting = false;
        }
    }

    // API вызов
    async apiCall(action, data = {}) {
        console.log('📡 API Call:', action, data);

        // Блокируем UI перед запросом
        this.disableUI();
        
        try {
            // Добавляем небольшую задержку между запросами
            await new Promise(resolve => setTimeout(resolve, 500));
            
            const url = new URL(this.apiUrl);
            url.searchParams.set('action', action);
            url.searchParams.set('data', JSON.stringify(data));
            
            console.log('Fetching URL:', url.toString());
            
            const response = await fetch(url.toString());
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const result = await response.json();
            console.log('✅ API Response:', result);
            
            if (result.status === 'success') {
                return result.data;
            } else {
                throw new Error(result.message || 'Unknown API error');
            }
            
        } catch (error) {
            console.error('❌ API Error:', error);
            
            // Специальная обработка для CORS ошибок
            if (error.message.includes('Failed to fetch') || error.message.includes('CORS') || error.message.includes('status: 0')) {
                console.log('CORS/Network error detected, trying JSONP approach...');
                return this.apiCallJSONP(action, data);
            }
            
            throw new Error('Ошибка соединения: ' + error.message);
        } finally {
            // Всегда разблокируем UI после завершения запроса
            this.hideLoading();
        }
    }

    // Альтернативный метод для обхода CORS
    async apiCallAlternative(action, data = {}) {
        try {
            // Используем proxy или другой метод
            const proxyUrl = 'https://cors-anywhere.herokuapp.com/';
            const targetUrl = `${this.apiUrl}?action=${action}&data=${encodeURIComponent(JSON.stringify(data))}`;
            
            const response = await fetch(proxyUrl + targetUrl);
            const result = await response.json();
            
            if (result.status === 'success') {
                return result.data;
            } else {
                throw new Error(result.message);
            }
        } catch (error) {
            throw new Error('Ошибка альтернативного соединения: ' + error.message);
        }
    }
    
    // Сбор данных из формы заявки
    collectOrderItems() {
        const items = [];
        
        // Используем сохранённые данные вместо прямого чтения из DOM
        Object.keys(this.currentOrderData).forEach(key => {
            const [productName, supplier] = key.split('|');
            const data = this.currentOrderData[key];
            
            if (data.quantity > 0) {
                // Находим соответствующий продукт для получения unit
                const product = this.currentProducts.find(p => 
                    p.name === productName && p.supplier === supplier
                );
                
                if (product) {
                    items.push({
                        product_name: productName,
                        quantity: data.quantity,
                        unit: product.unit,
                        supplier: supplier,
                        comment: data.comment || ''
                    });
                }
            }
        });
        
        return items;
    }
    // Загрузка истории заявок
    async loadOrderHistory() {
        try {
            
            // Защита от слишком частых вызовов
            if (this._loadingHistory) {
                console.log('History already loading, skipping...');
                return;
            }
            this._loadingHistory = true;
            
            this.disableUI(); // Блокируем UI перед загрузкой   
            console.log('=== LOAD ORDER HISTORY CLIENT ===');
            console.log('Current user phone:', this.currentUser.phone);
            
            this.showLoading('Загрузка истории...');

            // Добавляем задержку перед запросом
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            const history = await this.apiCall('get_order_history', {
                userPhone: this.currentUser.phone
            });
            
            console.log('Received history from API:', history);
            console.log('History type:', typeof history);
            console.log('Is array:', Array.isArray(history));
            
            if (Array.isArray(history)) {
                this.ordersHistory = history;
                console.log('Processed history:', this.ordersHistory);
            } else {
                console.log('History is not array, setting empty array');
                this.ordersHistory = [];
            }
            
            this.hideLoading();
            this.enableUI(); // Разблокируем UI после загрузки
            this.renderScreen('order_history');
            
        } catch (error) {
            console.error('Load history error:', error);
            this.hideLoading();
            this.enableUI(); // Разблокируем UI при ошибке
            this.showNotification('error', 'Ошибка загрузки истории: ' + error.message);
            // Все равно показываем экран истории, но с пустым списком
            this.ordersHistory = [];
            this.renderScreen('order_history');
        } finally {
            this._loadingHistory = false;
        }
    }    

    // Рендер экранов
    renderScreen(screenName, data = null) {
        this.currentScreen = screenName;
        const app = document.getElementById('app');
        
        const isBackNavigation = screenName === 'main' || screenName === 'template_selection';
        const exitAnimation = isBackNavigation ? 'screen-exit-back' : 'screen-exit';
        
        if (app.children.length > 0) {
            const currentScreen = app.children[0];
            currentScreen.classList.add(exitAnimation);
        }
        
        setTimeout(() => {
            let screenHTML = '';
            switch(screenName) {
                case 'login':
                    screenHTML = this.renderLoginScreen();
                    break;
                case 'main':
                    screenHTML = this.renderMainScreen();
                    break;
                case 'template_selection':
                    screenHTML = this.renderTemplateSelectionScreen();
                    break;
                case 'add_product':
                    screenHTML = this.renderAddProductScreen(data);
                    break;
                case 'add_supplier':
                    screenHTML = this.renderAddSupplierScreen();
                    break;
                case 'delete_product':
                    screenHTML = this.renderDeleteProductScreen(data);
                    break;
                case 'delete_supplier':
                    screenHTML = this.renderDeleteSupplierScreen(data);
                    break;
                case 'delete_product':
                    screenHTML = this.renderDeleteProductScreen(data);
                    break;
                case 'manage_templates':
                    screenHTML = this.renderTemplatesManagementScreen(data);
                    break;
                case 'manage_users':
                    screenHTML = this.renderUsersManagementScreen(data);
                    break;
                case 'order_creation':
                    screenHTML = this.renderOrderCreationScreen(data);
                    break;
                case 'order_history':
                    screenHTML = this.renderOrderHistoryScreen();
                    break;
            }
            
            app.innerHTML = screenHTML;

            if (screenName === 'order_creation') {
                this.initToggleSwitch();
            }
            if (screenName === 'delete_product') {
                setTimeout(() => {
                    this.setupProductSelection();
                }, 100);
            }
            if (screenName === 'order_history') {
                setTimeout(() => {
                    this.setupModalClose();
                }, 100);
            }
            
        }, 300);
    }
    
    // Рендер экрана добавления товара
    renderAddProductScreen(data) {
        const tagsOptions = data.tags ? data.tags.map(tag => 
            `<option value="${tag}">${tag}</option>`
        ).join('') : '';
    
        const suppliersOptions = data.suppliers ? data.suppliers.map(supplier => 
            `<option value="${supplier}">${supplier}</option>`
        ).join('') : '';
    
        return `
            <div class="main-screen screen-transition">
                <header class="header">
                    <button class="back-btn" onclick="app.renderScreen('main')">◀️ Назад</button>
                    <h1>Добавить товар</h1>
                </header>
                
                <form id="addProductForm" class="form">
                    <div class="input-group">
                        <label>Название товара *</label>
                        <input type="text" id="productName" required>
                    </div>
                    
                    <div class="input-group">
                        <label>Теги *</label>
                        <select id="productTags" required>
                            <option value="">-- Выберите тег --</option>
                            ${tagsOptions}
                            <option value="_custom">-- Добавить свой тег --</option>
                        </select>
                    </div>

                    <div class="input-group" id="customTagGroup" style="display: none;">
                        <label>Новый тег *</label>
                        <input type="text" id="customTag" placeholder="Введите новый тег">
                    </div>
                    
                    <div class="input-group">
                        <label>Единица измерения *</label>
                        <input type="text" id="productUnit" required value="шт">
                    </div>
                    
                    <div class="input-group">
                        <label>Срок годности (дни)</label>
                        <input type="number" id="productShelfLife" min="0">
                    </div>
                    
                    <div class="input-group">
                        <label>Минимальный запас *</label>
                        <input type="number" id="productMinStock" required min="0" value="1">
                    </div>
                    
                    <div class="input-group">
                        <label>Поставщик *</label>
                        <select id="productSupplier" required>
                            <option value="">-- Выберите поставщика --</option>
                            ${suppliersOptions}
                        </select>
                    </div>
                    
                    <button type="submit" class="btn primary" style="width: 100%;">
                        ➕ Добавить товар
                    </button>
                </form>
                
                <div id="productStatus" class="status"></div>
            </div>
        `;
    }
    
    // Рендер экрана добавления поставщика
    renderAddSupplierScreen() {
        return `
            <div class="main-screen screen-transition">
                <header class="header">
                    <button class="back-btn" onclick="app.renderScreen('main')">◀️ Назад</button>
                    <h1>Добавить поставщика</h1>
                </header>
                
                <form id="addSupplierForm" class="form">
                    <div class="input-group">
                        <label>Название поставщика *</label>
                        <input type="text" id="supplierName" required>
                    </div>
                    
                    <div class="input-group">
                        <label>Telegram ID</label>
                        <input type="text" id="supplierTgId">
                    </div>
                    
                    <div class="input-group">
                        <label>Телефон *</label>
                        <input type="tel" id="supplierPhone" required>
                    </div>
                    
                    <button type="submit" class="btn primary" style="width: 100%;">
                        🏢 Добавить поставщика
                    </button>
                </form>
                
                <div id="supplierStatus" class="status"></div>
            </div>
        `;
    }
    renderLoginScreen() {
        return `
            <div class="login-screen">
                <div class="logo">
                    <img src="${getAppLogo()}" alt="Restaurant Orders" style="width: 80px; height: 80px;">
                </div>
                <h1>Bono заявки</h1>
                <p style="color: #7f8c8d; margin-bottom: 30px; text-align: center;">Система управления заявками</p>
                
                <form id="loginForm" class="form">
                    <div class="input-group">
                        <input type="tel" id="phone" placeholder="Телефон" required>
                    </div>
                    <div class="input-group">
                        <input type="password" id="password" placeholder="Пароль" required>
                    </div>
                    <button type="submit" class="btn primary" style="width: 100%;">Войти</button>
                </form>
                
                <div id="loginStatus" class="status"></div>
            </div>
        `;
    }

    // Рендер главного экрана
    renderMainScreen() {
        const adminActions = this.isAdmin ? `
            <div class="action-card" onclick="app.handleMainAction('add_product')">
                <div class="action-content">
                    <div class="action-icon">➕</div>
                    <h3>Добавить товар</h3>
                    <p>Добавить новый товар в базу</p>
                </div>
            </div>
            
            <div class="action-card" onclick="app.handleMainAction('add_supplier')">
                <div class="action-content">
                    <div class="action-icon">🏢</div>
                    <h3>Добавить поставщика</h3>
                    <p>Добавить нового поставщика</p>
                </div>
            </div>
    
            <div class="action-card" onclick="app.handleMainAction('delete_product')">
                <div class="action-content">
                    <div class="action-icon">🗑️</div>
                    <h3>Удалить товар</h3>
                    <p>Удалить товары из базы</p>
                </div>
            </div>
    
            <div class="action-card" onclick="app.handleMainAction('delete_supplier')">
                <div class="action-content">
                    <div class="action-icon">❌</div>
                    <h3>Удалить поставщика</h3>
                    <p>Удалить поставщиков из базы</p>
                </div>
            </div>
        ` : '';
    
        const superAdminActions = this.isSuperAdmin ? `
            <div class="action-card" onclick="app.handleMainAction('manage_templates')">
                <div class="action-content">
                    <div class="action-icon">⚙️</div>
                    <h3>Настроить шаблоны</h3>
                    <p>Управление шаблонами заявок</p>
                </div>
            </div>
    
            <div class="action-card" onclick="app.handleMainAction('manage_users')">
                <div class="action-content">
                    <div class="action-icon">👥</div>
                    <h3>Пользователи</h3>
                    <p>Управление пользователями</p>
                </div>
            </div>
        ` : '';
    
        return `
            <div class="main-screen screen-transition">
                <header class="header">
                    <h1>Главная</h1>
                    <div class="user-info">
                        ${this.currentUser.department} • ${this.currentUser.position}
                        ${this.isAdmin ? ' • 👑 Админ' : ''}
                        ${this.isSuperAdmin ? ' • 👑 Супер-админ' : ''}
                    </div>
                </header>
                
                <div class="actions-grid">
                    <div class="action-card" onclick="app.handleMainAction('new_order')">
                        <div class="action-content">
                            <div class="action-icon">📋</div>
                            <h3>Новая заявка</h3>
                            <p>Создать заказ поставщикам</p>
                        </div>
                    </div>
                    
                    <div class="action-card" onclick="app.handleMainAction('history')">
                        <div class="action-content">
                            <div class="action-icon">📊</div>
                            <h3>История заявок</h3>
                            <p>Посмотреть отправленные</p>
                        </div>
                    </div>
                    
                    ${adminActions}
                    ${superAdminActions}
                    
                    <div class="action-card" onclick="app.handleMainAction('logout')">
                        <div class="action-content">
                            <div class="action-icon">🚪</div>
                            <h3>Выйти</h3>
                            <p>Завершить сеанс</p>
                        </div>
                    </div>
                </div>
                
                <div class="notifications">
                    <h3>👋 Добро пожаловать, ${this.currentUser.name}!</h3>
                    <p>Доступные шаблоны: ${this.currentUser.templates.join(', ')}</p>
                </div>
            </div>
        `;
    }
    // Обработчик действий на главной странице
    handleMainAction(action) {
        const card = event.currentTarget;
        
        this.disableUI();
        this.animateCardClick(card, () => {
            switch(action) {
                case 'new_order':
                    this.loadUserTemplates();
                    break;
                    
                case 'history':
                    this.loadOrderHistory();
                    break;
                
                case 'add_product':
                    this.showAddProductScreen();
                    break;
                
                case 'add_supplier':
                    this.showAddSupplierScreen();
                    break;

                case 'delete_product':
                    this.showDeleteProductScreen();
                    break;

                case 'delete_supplier':
                    this.showDeleteSupplierScreen();
                    break;

                case 'manage_templates':
                    this.showTemplatesManagementScreen();
                    break;

                case 'manage_users':
                    this.showUsersManagementScreen();
                    break;
                    
                case 'logout':
                    this.showLoading('Выход из системы...');
                    setTimeout(() => {
                        this.logout();
                    }, 500);
                    break;
            }
        });
    }
    
    // Рендер экрана выбора шаблона
    renderTemplateSelectionScreen() {
        let templatesHtml = '';
        
        if (this.availableTemplates.length === 0) {
            templatesHtml = `
                <div style="text-align: center; padding: 40px; color: #7f8c8d;">
                    <div style="font-size: 3rem; margin-bottom: 20px;">📭</div>
                    <h3>Шаблоны не найдены</h3>
                    <p>Обратитесь к администратору для настройки доступов</p>
                </div>
            `;
        } else {
            templatesHtml = '<div class="templates-grid">';
            
            this.availableTemplates.forEach((template, index) => {
                templatesHtml += `
                    <div class="template-card" onclick="app.handleTemplateSelect('${template.name}', this)">
                        <div class="template-content">
                            <div class="template-icon">${template.type === 'daily' ? '📅' : '📦'}</div>
                            <h3>${template.name}</h3>
                            <p>${template.type === 'daily' ? 'Ежедневная закупка' : 'Еженедельная закупка'}</p>
                        </div>
                    </div>
                `;
            });
            
            templatesHtml += '</div>';
        }
        
        return `
            <div class="template-screen screen-transition">
                <header class="header">
                    <button class="back-btn" onclick="app.handleBackButton()">◀️ Назад</button>
                    <h1>Выбор шаблона</h1>
                </header>
                ${templatesHtml}
            </div>
        `;
    }

    // Показать экран добавления товара
    async showAddProductScreen() {
        try {
            this.showLoading('Загрузка данных...');
            const data = await this.apiCall('get_product_form_data');
            this.hideLoading();
            this.renderScreen('add_product', data);
            
            // Добавляем обработчики после рендера
            setTimeout(() => {
                const tagsSelect = document.getElementById('productTags');
                if (tagsSelect) {
                    tagsSelect.addEventListener('change', (e) => {
                        this.handleTagSelection(e.target.value);
                    });
                }
            }, 100);
        } catch (error) {
            this.hideLoading();
            this.showNotification('error', 'Ошибка загрузки: ' + error.message);
        }
    }
    
    // Показать экран добавления поставщика
    showAddSupplierScreen() {
        this.renderScreen('add_supplier');
    }
    // Новые методы для удаления товаров
    async showDeleteProductScreen() {
        let productsData = this.getCachedData('Products');
        let formData = this.getCachedData('ProductFormData'); // если кэшируем и это
        
        if (!productsData || !formData) {
          // если нет в кэше, загружаем с сервера
          this.showLoading('Загрузка товаров...');
          const [pResult, fResult] = await Promise.all([
              this.apiCall('get_all_products'),
              this.apiCall('get_product_form_data')
          ]);
          productsData = pResult;
          formData = fResult;
          this.saveCachedData('Products', pResult);
          this.saveCachedData('ProductFormData', fResult);
          this.hideLoading();
        }
        
        this.renderScreen('delete_product', { 
          products: productsData.products || [], 
          tags: formData.tags || [] 
        });
    }
    // Обновленный renderDeleteProductScreen с правильным расположением поиска
    renderDeleteProductScreen(data) {
        const { products = [], tags = [] } = data;
        
        const tagsOptions = tags.map(tag => 
            `<option value="${tag}">${tag}</option>`
        ).join('');
    
        const renderProductsList = (productsToRender) => {
            return productsToRender.length > 0 ? productsToRender.map(product => `
                <div class="product-item" data-tags="${product.product_tags}" data-name="${product.name.toLowerCase()}">
                    <input type="checkbox" id="product_${product.id}" name="products" value="${product.id}">
                    <label for="product_${product.id}">
                        <strong>${product.name}</strong> 
                        <span style="color: #666; font-size: 12px;">
                            (${product.product_tags} • ${product.unit} • ${product.supplier})
                        </span>
                    </label>
                </div>
            `).join('') : `
                <div style="text-align: center; padding: 20px; color: #7f8c8d;">
                    <p>Товары не найдены</p>
                </div>
            `;
        };
    
        return `
            <div class="main-screen screen-transition">
                <header class="header">
                    <button class="back-btn" onclick="app.renderScreen('main')">◀️ Назад</button>
                    <h1>Удаление товаров</h1>
                </header>
                
                <div class="form">
                    <div class="input-group">
                        <label>Фильтр по тегам (можно выбрать несколько):</label>
                        <select id="tagFilter" multiple style="height: 120px;" onchange="app.filterProducts()">
                            ${tagsOptions}
                        </select>
                        <small>Удерживайте Ctrl для выбора нескольких тегов</small>
                        <div style="margin-top: 5px;">
                            <button class="btn secondary" onclick="app.clearTagFilter()" style="padding: 5px 10px; font-size: 12px; margin-right: 5px;">
                                Очистить теги
                            </button>
                            <button class="btn secondary" onclick="app.selectAllTags()" style="padding: 5px 10px; font-size: 12px;">
                                Выбрать все
                            </button>
                        </div>
                    </div>
    
                    <div class="input-group">
                        <label>Список товаров (можно выбрать несколько):</label>
                        
                        <!-- Поиск по названию ПРЯМО ПЕРЕД списком -->
                        <div style="margin-bottom: 10px;">
                            <input type="text" id="productSearch" placeholder="Поиск по названию товара..." 
                                   oninput="app.filterProductsBySearch()" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
                        </div>
                        
                        <!-- Чекбокс "Выбрать все видимые" ПРЯМО ПЕРЕД списком -->
                        <div style="margin-bottom: 10px; display: flex; align-items: center; gap: 8px;">
                            <input type="checkbox" id="selectAllProducts" onchange="app.toggleSelectAllProducts()">
                            <label for="selectAllProducts" style="font-size: 14px; margin: 0;">
                                Выбрать все видимые товары
                            </label>
                        </div>
                        
                        <div id="productsListContainer" class="products-list" style="max-height: 300px; overflow-y: auto; border: 1px solid #ddd; padding: 10px;">
                            ${renderProductsList(products)}
                        </div>
                        <div style="margin-top: 10px; font-size: 12px; color: #7f8c8d;">
                            Найдено товаров: <span id="productsCount">${products.length}</span> | 
                            Выбрано: <span id="selectedCount">0</span>
                        </div>
                    </div>
                    
                    <button class="btn primary" onclick="app.deleteSelectedProducts()" style="width: 100%; background-color: #e74c3c;">
                        🗑️ Удалить выбранные товары (0)
                    </button>
                </div>
                
                <div id="deleteProductStatus" class="status"></div>
            </div>
        `;
    }
    // Метод для поиска по названию
    filterProductsBySearch() {
        this.filterProducts();
    }

    // Метод для выбора всех тегов
    selectAllTags() {
        const tagFilter = document.getElementById('tagFilter');
        for (let i = 0; i < tagFilter.options.length; i++) {
            tagFilter.options[i].selected = true;
        }
        this.filterProducts();
    }

    // Исправленный метод для выбора всех видимых товаров
    toggleSelectAllProducts() {
        const selectAllCheckbox = document.getElementById('selectAllProducts');
        const isChecked = selectAllCheckbox.checked;
        
        console.log('Toggle select all:', isChecked);
        
        // Находим все ВИДИМЫЕ товары (используем более надежный метод)
        const allProductItems = document.querySelectorAll('.product-item');
        let visibleCount = 0;
        
        allProductItems.forEach(item => {
            // Проверяем видимость через computed style
            const style = window.getComputedStyle(item);
            const isVisible = style.display !== 'none' && style.visibility !== 'hidden';
            
            if (isVisible) {
                visibleCount++;
                const checkbox = item.querySelector('input[type="checkbox"]');
                if (checkbox) {
                    checkbox.checked = isChecked;
                    console.log('Setting checkbox:', checkbox.id, isChecked);
                }
            }
        });
        
        console.log('Visible items:', visibleCount);
        this.updateSelectionCount();
    }
    // Метод для обновления счетчика выбранных товаров
    updateSelectionCount() {
        const selectedCheckboxes = document.querySelectorAll('.product-item input[type="checkbox"]:checked');
        const selectedCount = selectedCheckboxes.length;
        
        document.getElementById('selectedCount').textContent = selectedCount;
        
        const deleteButton = document.querySelector('.btn.primary');
        if (deleteButton) {
            deleteButton.textContent = `🗑️ Удалить выбранные товары (${selectedCount})`;
        }
    }
    // Добавим обработчик событий для чекбоксов после рендера
    setupProductSelection() {
        const checkboxes = document.querySelectorAll('.product-item input[type="checkbox"]');
        checkboxes.forEach(checkbox => {
            checkbox.addEventListener('change', () => {
                this.updateSelectionCount();
            });
        });
    }
    
    // Улучшенный метод фильтрации
    filterProducts() {
        const searchTerm = document.getElementById('productSearch').value.toLowerCase();
        const tagFilter = document.getElementById('tagFilter');
        const selectedTags = Array.from(tagFilter.selectedOptions).map(option => option.value);
        
        const allProductItems = document.querySelectorAll('.product-item');
        let visibleCount = 0;
        
        allProductItems.forEach(item => {
            const productTags = item.getAttribute('data-tags');
            const productName = item.getAttribute('data-name');
            const productTagArray = productTags ? productTags.split(',').map(tag => tag.trim()) : [];
            
            const matchesSearch = !searchTerm || productName.includes(searchTerm);
            const matchesTags = selectedTags.length === 0 || 
                              productTagArray.some(tag => selectedTags.includes(tag));
            
            const shouldShow = matchesSearch && matchesTags;
            item.style.display = shouldShow ? 'block' : 'none';
            
            if (shouldShow) visibleCount++;
        });
        
        document.getElementById('productsCount').textContent = visibleCount;
        this.updateSelectionCount();
        
        // Сбрасываем "Выбрать все" при фильтрации
        const selectAllCheckbox = document.getElementById('selectAllProducts');
        if (selectAllCheckbox) {
            selectAllCheckbox.checked = false;
        }
    }
    
    // Новый метод для фильтрации товаров по тегам
    filterProductsByTags() {
        const tagFilter = document.getElementById('tagFilter');
        const selectedTags = Array.from(tagFilter.selectedOptions).map(option => option.value);
        
        const allProductItems = document.querySelectorAll('.product-item');
        let visibleCount = 0;
        
        allProductItems.forEach(item => {
            const productTags = item.getAttribute('data-tags');
            const productTagArray = productTags ? productTags.split(',').map(tag => tag.trim()) : [];
            
            // Показываем товар если:
            // - не выбраны теги (показываем все)
            // - или товар имеет хотя бы один из выбранных тегов
            const shouldShow = selectedTags.length === 0 || 
                              productTagArray.some(tag => selectedTags.includes(tag));
            
            item.style.display = shouldShow ? 'block' : 'none';
            if (shouldShow) visibleCount++;
        });
        
        // Обновляем счетчик
        document.getElementById('productsCount').textContent = visibleCount;
    }
    
    // Метод для очистки фильтра
    clearTagFilter() {
        const tagFilter = document.getElementById('tagFilter');
        tagFilter.selectedIndex = -1;
        this.filterProductsByTags();
    }
    
    // Обновленный метод для удаления товаров с учетом фильтрации
    async deleteSelectedProducts() {
        const selectedProducts = Array.from(document.querySelectorAll('.product-item input[name="products"]:checked'))
            .map(checkbox => checkbox.value);
    
        if (selectedProducts.length === 0) {
            this.showNotification('error', 'Выберите хотя бы один товар для удаления');
            return;
        }

         // Кастомное подтверждение вместо стандартного confirm
        const userConfirmed = await this.showCustomConfirm(`Удалить ${selectedProducts.length} товар(ов)?`);
        if (!userConfirmed) {
            return;
        }
    
        try {
            this.showLoading('Удаление товаров...');
            await this.apiCall('delete_products', { productIds: selectedProducts });
            localStorage.removeItem('cache_Products');
            localStorage.removeItem('cache_ProductFormData');
            localStorage.removeItem('cache_versions');
            this.showSuccess('Товары успешно удалены!');
            setTimeout(() => {
                this.showDeleteProductScreen();
            }, 2000);
        } catch (error) {
            this.hideLoading();
            this.showNotification('error', 'Ошибка удаления: ' + error.message);
        }
    }
    // Новые методы для удаления поставщиков
    async showDeleteSupplierScreen() {
        try {
            this.showLoading('Загрузка поставщиков...');
            const result = await this.apiCall('get_all_suppliers');
            this.hideLoading();
            
            // Проверяем структуру ответа
            console.log('Suppliers result:', result);
            const suppliers = result.suppliers || [];
            
            this.renderScreen('delete_supplier', { suppliers });
        } catch (error) {
            this.hideLoading();
            this.showNotification('error', 'Ошибка загрузки: ' + error.message);
        }
    }
    
    renderDeleteSupplierScreen(data) {
        const { suppliers = [] } = data;
        
        console.log('Rendering delete suppliers:', suppliers);
        
        const suppliersList = suppliers.length > 0 ? suppliers.map(supplier => `
            <div class="supplier-item">
                <input type="checkbox" id="supplier_${supplier.id}" name="suppliers" value="${supplier.id}">
                <label for="supplier_${supplier.id}">
                    <strong>${supplier.name}</strong> 
                    <span style="color: #666; font-size: 12px;">
                        (${supplier.phone} ${supplier.tg_id ? '• TG: ' + supplier.tg_id : ''})
                    </span>
                </label>
            </div>
        `).join('') : `
            <div style="text-align: center; padding: 20px; color: #7f8c8d;">
                <p>Поставщики не найдены</p>
            </div>
        `;
    
        return `
            <div class="main-screen screen-transition">
                <header class="header">
                    <button class="back-btn" onclick="app.renderScreen('main')">◀️ Назад</button>
                    <h1>Удаление поставщиков</h1>
                </header>
                
                <div class="form">
                    <div class="input-group">
                        <label>Список поставщиков (можно выбрать несколько):</label>
                        <div class="suppliers-list" style="max-height: 400px; overflow-y: auto; border: 1px solid #ddd; padding: 10px;">
                            ${suppliersList}
                        </div>
                    </div>
                    
                    <button class="btn primary" onclick="app.deleteSelectedSuppliers()" style="width: 100%; background-color: #e74c3c;">
                        🗑️ Удалить выбранных поставщиков
                    </button>
                </div>
                
                <div id="deleteSupplierStatus" class="status"></div>
            </div>
        `;
    }
    
    // Метод для кастомного подтверждения
    showCustomConfirm(message) {
        return new Promise((resolvePromise) => {
            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay';
            overlay.style.display = 'flex';
            overlay.style.zIndex = '10001';
            
            overlay.innerHTML = `
                <div class="modal-content" style="max-width: 300px; text-align: center;">
                    <div style="padding: 20px;">
                        <h3 style="margin-bottom: 15px;">Подтверждение</h3>
                        <p style="margin-bottom: 20px;">${message}</p>
                        <div style="display: flex; gap: 10px; justify-content: center;">
                            <button id="confirmCancel" class="btn secondary" style="flex: 1;">
                                Отмена
                            </button>
                            <button id="confirmOk" class="btn primary" style="flex: 1; background-color: #e74c3c;">
                                Удалить
                            </button>
                        </div>
                    </div>
                </div>
            `;
            
            document.body.appendChild(overlay);
            
            // Обработчики событий
            const cancelButton = overlay.querySelector('#confirmCancel');
            const okButton = overlay.querySelector('#confirmOk');
            
            const closeModal = (result) => {
                overlay.remove();
                resolvePromise(result);
            };
            
            cancelButton.addEventListener('click', () => closeModal(false));
            okButton.addEventListener('click', () => closeModal(true));
            
            // Закрытие по клику на overlay
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    closeModal(false);
                }
            });
            
            // Закрытие по ESC
            const handleKeydown = (e) => {
                if (e.key === 'Escape') {
                    closeModal(false);
                }
            };
            document.addEventListener('keydown', handleKeydown);
            
            // Убираем обработчик после закрытия
            overlay.addEventListener('remove', () => {
                document.removeEventListener('keydown', handleKeydown);
            });
        });
    }
    async deleteSelectedSuppliers() {
        const selectedSuppliers = Array.from(document.querySelectorAll('input[name="suppliers"]:checked'))
            .map(checkbox => checkbox.value);
    
        if (selectedSuppliers.length === 0) {
            this.showNotification('error', 'Выберите хотя бы одного поставщика для удаления');
            return;
        }
    
        const userConfirmed = await this.showCustomConfirm(`Удалить ${selectedSuppliers.length} поставщик(ов)?`);
        if (!userConfirmed) {
            return;
        }
    
        try {
            this.showLoading('Удаление поставщиков...');
            await this.apiCall('delete_suppliers', { supplierIds: selectedSuppliers });
            localStorage.removeItem('cache_Suppliers');
            localStorage.removeItem('cache_versions');
            this.showSuccess('Поставщики успешно удалены!');
            setTimeout(() => {
                this.showDeleteSupplierScreen();
            }, 2000);
        } catch (error) {
            this.showNotification('error', 'Ошибка удаления: ' + error.message);
        }
    }

    // Новые методы для управления шаблонами
    async showTemplatesManagementScreen() {
      try {
        this.showLoading('Загрузка шаблонов...');
        const data = await this.apiCall('get_templates_management_data');
        this.hideLoading();
        
        this.renderScreen('manage_templates', { 
          templates: data.templates || [], 
          tags: data.tags || [] 
        });
        
        // После рендера инициализируем выбранные теги (если нужно)
        setTimeout(() => {
          this.initTemplateTagsSelection(data.templates || []);
        }, 100);
      } catch (error) {
        this.hideLoading();
        this.showNotification('error', 'Ошибка загрузки: ' + error.message);
      }
    }
    
    // Обновленный renderTemplatesManagementScreen с правильным отображением выбранных тегов
    renderTemplatesManagementScreen(data) {
        const { templates = [], tags = [] } = data;
        
        const templatesList = templates.length > 0 ? templates.map(template => {
            // Подготавливаем выбранные теги для этого шаблона
            const templateTags = template.product_tags ? template.product_tags.split(',').map(tag => tag.trim()) : [];
            
            const tagsOptions = tags.map(tag => 
                `<option value="${tag}" ${templateTags.includes(tag) ? 'selected' : ''}>${tag}</option>`
            ).join('');
    
            return `
                <div class="template-item" style="border: 1px solid #ddd; padding: 15px; margin-bottom: 15px; border-radius: 8px;">
                    <div class="input-group">
                        <label>Название шаблона:</label>
                        <input type="text" id="name_${template.id}" value="${template.name}" style="width: 100%;">
                    </div>
                    <div class="input-group">
                        <label>Тип:</label>
                        <select id="type_${template.id}" style="width: 100%;">
                            <option value="daily" ${template.type === 'daily' ? 'selected' : ''}>Ежедневный</option>
                            <option value="weekly" ${template.type === 'weekly' ? 'selected' : ''}>Еженедельный</option>
                            <option value="anytime" ${template.type === 'anytime' ? 'selected' : ''}>Любое время</option>
                        </select>
                    </div>
                    <div class="input-group">
                        <label>Теги товаров (можно выбрать несколько):</label>
                        <select id="tags_${template.id}" multiple style="height: 100px; width: 100%;">
                            ${tagsOptions}
                        </select>
                        <small>Удерживайте Ctrl для выбора нескольких тегов</small>
                        <div style="margin-top: 5px;">
                            <button type="button" class="btn secondary" onclick="app.selectAllTemplateTags('${template.id}')" style="padding: 3px 8px; font-size: 11px;">
                                Выбрать все
                            </button>
                            <button type="button" class="btn secondary" onclick="app.clearTemplateTags('${template.id}')" style="padding: 3px 8px; font-size: 11px; margin-left: 5px;">
                                Очистить
                            </button>
                        </div>
                    </div>
                    <div class="input-group">
                        <label>Telegram ID админа (через запятую):</label>
                        <input type="text" id="tg_admin_${template.id}" value="${template.tg_id_admin ? template.tg_id_admin.replace(/'/g, '') : ''}" style="width: 100%;" placeholder="940486322,123456789">
                        <small>Введите ID через запятую без пробелов</small>
                    </div>
                    <div style="display: flex; gap: 10px; margin-top: 10px;">
                        <button class="btn primary" onclick="app.updateTemplate('${template.id}')" style="flex: 1;">💾 Сохранить</button>
                        <button class="btn" onclick="app.deleteTemplate('${template.id}')" style="flex: 1; background-color: #e74c3c; color: white;">🗑️ Удалить</button>
                    </div>
                </div>
            `;
        }).join('') : `
            <div style="text-align: center; padding: 20px; color: #7f8c8d;">
                <p>Шаблоны не найдены</p>
            </div>
        `;
    
        return `
            <div class="main-screen screen-transition">
                <header class="header">
                    <button class="back-btn" onclick="app.renderScreen('main')">◀️ Назад</button>
                    <h1>Управление шаблонами</h1>
                </header>
                
                <div class="form">
                    <h3>Добавить новый шаблон</h3>
                    <div class="input-group">
                        <label>Название шаблона:</label>
                        <input type="text" id="newTemplateName">
                    </div>
                    <div class="input-group">
                        <label>Тип:</label>
                        <select id="newTemplateType">
                            <option value="daily">Ежедневный</option>
                            <option value="weekly">Еженедельный</option>
                            <option value="anytime">Любое время</option>
                        </select>
                    </div>
                    <div class="input-group">
                        <label>Теги товаров (можно выбрать несколько):</label>
                        <select id="newTemplateTags" multiple style="height: 100px; width: 100%;">
                            ${tags.map(tag => `<option value="${tag}">${tag}</option>`).join('')}
                        </select>
                        <small>Удерживайте Ctrl для выбора нескольких тегов</small>
                        <div style="margin-top: 5px;">
                            <button type="button" class="btn secondary" onclick="app.selectAllNewTemplateTags()" style="padding: 3px 8px; font-size: 11px;">
                                Выбрать все
                            </button>
                            <button type="button" class="btn secondary" onclick="app.clearNewTemplateTags()" style="padding: 3px 8px; font-size: 11px; margin-left: 5px;">
                                Очистить
                            </button>
                        </div>
                    </div>
                    <div class="input-group">
                        <label>Telegram ID админа (через запятую):</label>
                        <input type="text" id="newTemplateTgAdmin" placeholder="940486322,123456789">
                        <small>Введите ID через запятую без пробелов</small>
                    </div>
                    <button class="btn primary" onclick="app.addNewTemplate()" style="width: 100%;">
                        ➕ Добавить шаблон
                    </button>
                </div>
    
                <div style="margin-top: 30px;">
                    <h3>Существующие шаблоны</h3>
                    ${templatesList}
                </div>
                
                <div id="templateStatus" class="status"></div>
            </div>
        `;
    }
    
    // Исправленный метод обновления шаблона
    async updateTemplate(templateId) {
        const name = document.getElementById(`name_${templateId}`).value;
        const type = document.getElementById(`type_${templateId}`).value;
        
        // Получаем выбранные теги
        const tagsSelect = document.getElementById(`tags_${templateId}`);
        const selectedTags = Array.from(tagsSelect.selectedOptions).map(option => option.value);
        const product_tags = selectedTags.join(', ');
        
        const tg_id_admin = document.getElementById(`tg_admin_${templateId}`).value;
    
        if (!name || !type || selectedTags.length === 0) {
            this.showNotification('error', 'Заполните все обязательные поля');
            return;
        }
    
        try {
            this.showLoading('Обновление шаблона...');
            const result = await this.apiCall('update_template', { 
                templateId, 
                name, 
                type, 
                product_tags, 
                tg_id_admin 
            });
            localStorage.removeItem('cache_Templates');
            localStorage.removeItem('cache_versions');
            this.showSuccess('Шаблон успешно обновлен!');
            // Перезагружаем экран чтобы обновить данные
            setTimeout(() => {
                this.showTemplatesManagementScreen();
            }, 1500);
        } catch (error) {
            this.showNotification('error', 'Ошибка обновления: ' + error.message);
        }
}
    
    // Исправленный метод добавления шаблона
    async addNewTemplate() {
        const name = document.getElementById('newTemplateName').value;
        const type = document.getElementById('newTemplateType').value;
        
        // Получаем выбранные теги для нового шаблона
        const tagsSelect = document.getElementById('newTemplateTags');
        const selectedTags = Array.from(tagsSelect.selectedOptions).map(option => option.value);
        const product_tags = selectedTags.join(', ');
        
        let tg_id_admin = document.getElementById('newTemplateTgAdmin').value;
        
        // Очищаем Telegram ID от лишних пробелов, но сохраняем как строку
        tg_id_admin = tg_id_admin.split(',')
            .map(id => String(id.trim())) // Сохраняем как строку
            .filter(id => id)
            .join(',');
    
        if (!name || !type || selectedTags.length === 0) {
            this.showNotification('error', 'Заполните все обязательные поля');
            return;
        }
    
        try {
            this.showLoading('Добавление шаблона...');
            await this.apiCall('add_template', { 
                name, 
                type, 
                product_tags, 
                tg_id_admin 
            });
            localStorage.removeItem('cache_Templates');
            localStorage.removeItem('cache_versions');
            this.showSuccess('Шаблон успешно добавлен!');
            setTimeout(() => {
                this.showTemplatesManagementScreen();
            }, 2000);
        } catch (error) {
            this.hideLoading();
            this.showNotification('error', 'Ошибка добавления: ' + error.message);
        }
    }
    // Методы для работы с тегами в шаблонах
    selectAllTemplateTags(templateId) {
        const tagsSelect = document.getElementById(`tags_${templateId}`);
        for (let i = 0; i < tagsSelect.options.length; i++) {
            tagsSelect.options[i].selected = true;
        }
    }
    
    clearTemplateTags(templateId) {
        const tagsSelect = document.getElementById(`tags_${templateId}`);
        tagsSelect.selectedIndex = -1;
    }
    
    selectAllNewTemplateTags() {
        const tagsSelect = document.getElementById('newTemplateTags');
        for (let i = 0; i < tagsSelect.options.length; i++) {
            tagsSelect.options[i].selected = true;
        }
    }
    
    clearNewTemplateTags() {
        const tagsSelect = document.getElementById('newTemplateTags');
        tagsSelect.selectedIndex = -1;
    }
    
    // Добавим инициализацию выбранных тегов при загрузке экрана
    async showTemplatesManagementScreen() {
        try {
            this.showLoading('Загрузка шаблонов...');
            const result = await this.apiCall('get_all_templates');
            const formData = await this.apiCall('get_product_form_data');
            this.hideLoading();
            
            const templates = result.templates || [];
            const tags = formData.tags || [];
            
            this.renderScreen('manage_templates', { templates, tags });
            
            // Инициализируем выбранные теги после рендера
            setTimeout(() => {
                this.initTemplateTagsSelection(templates);
            }, 100);
            
        } catch (error) {
            this.hideLoading();
            this.showNotification('error', 'Ошибка загрузки: ' + error.message);
        }
    }
    
    // Метод для инициализации выбранных тегов в существующих шаблонах
    initTemplateTagsSelection(templates) {
        templates.forEach(template => {
            const tagsSelect = document.getElementById(`tags_${template.id}`);
            if (tagsSelect && template.product_tags) {
                const templateTags = template.product_tags.split(',').map(tag => tag.trim());
                for (let i = 0; i < tagsSelect.options.length; i++) {
                    const option = tagsSelect.options[i];
                    option.selected = templateTags.includes(option.value);
                }
            }
        });
    }
    
    async deleteTemplate(templateId) {
        const userConfirmed = await this.showCustomConfirm('Удалить этот шаблон?');
        if (!userConfirmed) {
            return;
        }
    
        try {
            this.showLoading('Удаление шаблона...');
            await this.apiCall('delete_template', { templateId });
            localStorage.removeItem('cache_Templates');
            localStorage.removeItem('cache_versions');
            this.showSuccess('Шаблон успешно удален!');
            setTimeout(() => {
                this.showTemplatesManagementScreen();
            }, 2000);
        } catch (error) {
            this.showNotification('error', 'Ошибка удаления: ' + error.message);
        }
    }

    // методы для управления пользователями
   async showUsersManagementScreen() {
      try {
        this.showLoading('Загрузка пользователей...');
        const data = await this.apiCall('get_users_management_data');
        this.hideLoading();
        
        this.renderScreen('manage_users', { 
          users: data.users || [], 
          templates: data.templates || [] 
        });
        
        setTimeout(() => {
          this.initUserTemplatesSelection(data.users || []);
        }, 100);
      } catch (error) {
        this.hideLoading();
        this.showNotification('error', 'Ошибка загрузки: ' + error.message);
      }
    }

    // Метод для инициализации выбранных шаблонов в существующих пользователях
    initUserTemplatesSelection(users) {
        users.forEach(user => {
            const templatesSelect = document.getElementById(`templates_${user.phone}`);
            if (templatesSelect && user.templates) {
                const userTemplates = user.templates.split(',').map(template => template.trim());
                for (let i = 0; i < templatesSelect.options.length; i++) {
                    const option = templatesSelect.options[i];
                    option.selected = userTemplates.includes(option.value);
                }
            }
        });
    }
    
    // Обновленный renderUsersManagementScreen с правильным отображением выбранных шаблонов
    renderUsersManagementScreen(data) {
        const { users = [], templates = [] } = data;
        
        const usersList = users.length > 0 ? users.map(user => {
            // Подготавливаем выбранные шаблоны для этого пользователя
            const userTemplates = user.templates ? user.templates.split(',').map(template => template.trim()) : [];
            
            const templatesOptions = templates.map(template => 
                `<option value="${template.name}" ${userTemplates.includes(template.name) ? 'selected' : ''}>${template.name}</option>`
            ).join('');
    
            return `
                <div class="user-item" style="border: 1px solid #ddd; padding: 15px; margin-bottom: 15px; border-radius: 8px;">
                    <h3>${user.name} (${user.phone ? user.phone.replace(/^'/, '') : ''})</h3>
                    <div class="input-group">
                        <label>Имя:</label>
                        <input type="text" id="name_${user.phone}" value="${user.name}" style="width: 100%;">
                    </div>
                    <div class="input-group">
                        <label>Пароль:</label>
                        <input type="text" id="password_${user.phone}" value="${user.password}" style="width: 100%;">
                    </div>
                    <div class="input-group">
                        <label>Отдел:</label>
                        <input type="text" id="department_${user.phone}" value="${user.department}" style="width: 100%;">
                    </div>
                    <div class="input-group">
                        <label>Должность:</label>
                        <input type="text" id="position_${user.phone}" value="${user.position}" style="width: 100%;">
                    </div>
                    <div class="input-group">
                        <label>Активен:</label>
                        <select id="active_${user.phone}" style="width: 100%;">
                            <option value="TRUE" ${user.is_active === 'TRUE' ? 'selected' : ''}>Активен</option>
                            <option value="FALSE" ${user.is_active === 'FALSE' ? 'selected' : ''}>Неактивен</option>
                        </select>
                    </div>
                    <div class="input-group">
                        <label>Шаблоны (можно выбрать несколько):</label>
                        <select id="templates_${user.phone}" multiple style="height: 100px; width: 100%;">
                            ${templatesOptions}
                        </select>
                        <small>Удерживайте Ctrl для выбора нескольких шаблонов</small>
                        <div style="margin-top: 5px;">
                            <button type="button" class="btn secondary" onclick="app.selectAllUserTemplates('${user.phone}')" style="padding: 3px 8px; font-size: 11px;">
                                Выбрать все
                            </button>
                            <button type="button" class="btn secondary" onclick="app.clearUserTemplates('${user.phone}')" style="padding: 3px 8px; font-size: 11px; margin-left: 5px;">
                                Очистить
                            </button>
                        </div>
                    </div>
                    <div class="input-group">
                        <label>Права:</label>
                        <select id="admin_${user.phone}" style="width: 100%;">
                            <option value="FALSE" ${user.admin === 'FALSE' ? 'selected' : ''}>Обычный пользователь</option>
                            <option value="TRUE" ${user.admin === 'TRUE' ? 'selected' : ''}>Администратор</option>
                            <option value="SUPER" ${user.admin === 'SUPER' ? 'selected' : ''}>Супер-администратор</option>
                        </select>
                    </div>
                    <div style="display: flex; gap: 10px; margin-top: 10px;">
                        <button class="btn primary" onclick="app.updateUser('${user.phone}')" style="flex: 1;">💾 Сохранить</button>
                        <button class="btn" onclick="app.deleteUser('${user.phone}')" style="flex: 1; background-color: #e74c3c; color: white;">🗑️ Удалить</button>
                    </div>
                </div>
            `;
        }).join('') : `
            <div style="text-align: center; padding: 20px; color: #7f8c8d;">
                <p>Пользователи не найдены</p>
            </div>
        `;
    
        return `
            <div class="main-screen screen-transition">
                <header class="header">
                    <button class="back-btn" onclick="app.renderScreen('main')">◀️ Назад</button>
                    <h1>Управление пользователями</h1>
                </header>
                
                <div class="form">
                    <h3>Добавить нового пользователя</h3>
                    <div class="input-group">
                        <label>Телефон:</label>
                        <input type="tel" id="newUserPhone">
                    </div>
                    <div class="input-group">
                        <label>Имя:</label>
                        <input type="text" id="newUserName">
                    </div>
                    <div class="input-group">
                        <label>Пароль:</label>
                        <input type="text" id="newUserPassword">
                    </div>
                    <div class="input-group">
                        <label>Отдел:</label>
                        <input type="text" id="newUserDepartment">
                    </div>
                    <div class="input-group">
                        <label>Должность:</label>
                        <input type="text" id="newUserPosition">
                    </div>
                    <div class="input-group">
                        <label>Шаблоны (можно выбрать несколько):</label>
                        <select id="newUserTemplates" multiple style="height: 100px; width: 100%;">
                            ${templates.map(template => `<option value="${template.name}">${template.name}</option>`).join('')}
                        </select>
                        <small>Удерживайте Ctrl для выбора нескольких шаблонов</small>
                        <div style="margin-top: 5px;">
                            <button type="button" class="btn secondary" onclick="app.selectAllNewUserTemplates()" style="padding: 3px 8px; font-size: 11px;">
                                Выбрать все
                            </button>
                            <button type="button" class="btn secondary" onclick="app.clearNewUserTemplates()" style="padding: 3px 8px; font-size: 11px; margin-left: 5px;">
                                Очистить
                            </button>
                        </div>
                    </div>
                    <div class="input-group">
                        <label>Права:</label>
                        <select id="newUserAdmin">
                            <option value="FALSE">Обычный пользователь</option>
                            <option value="TRUE">Администратор</option>
                            <option value="SUPER">Супер-администратор</option>
                        </select>
                    </div>
                    <button class="btn primary" onclick="app.addNewUser()" style="width: 100%;">
                        👥 Добавить пользователя
                    </button>
                </div>
    
                <div style="margin-top: 30px;">
                    <h3>Существующие пользователи</h3>
                    ${usersList}
                </div>
                
                <div id="userStatus" class="status"></div>
            </div>
        `;
    }

    // Методы для работы с шаблонами пользователей
    selectAllUserTemplates(userPhone) {
        const templatesSelect = document.getElementById(`templates_${userPhone}`);
        for (let i = 0; i < templatesSelect.options.length; i++) {
            templatesSelect.options[i].selected = true;
        }
    }
    
    clearUserTemplates(userPhone) {
        const templatesSelect = document.getElementById(`templates_${userPhone}`);
        templatesSelect.selectedIndex = -1;
    }
    
    selectAllNewUserTemplates() {
        const templatesSelect = document.getElementById('newUserTemplates');
        for (let i = 0; i < templatesSelect.options.length; i++) {
            templatesSelect.options[i].selected = true;
        }
    }
    
    clearNewUserTemplates() {
        const templatesSelect = document.getElementById('newUserTemplates');
        templatesSelect.selectedIndex = -1;
    }
    
    // Исправленный метод добавления пользователя
    async addNewUser() {
    const phone = document.getElementById('newUserPhone').value;
        const name = document.getElementById('newUserName').value;
        const password = document.getElementById('newUserPassword').value;
        const department = document.getElementById('newUserDepartment').value;
        const position = document.getElementById('newUserPosition').value;
        
        // Получаем выбранные шаблоны
        const templatesSelect = document.getElementById('newUserTemplates');
        const selectedTemplates = Array.from(templatesSelect.selectedOptions).map(option => option.value);
        const templates = selectedTemplates.join(', ');
        
        const admin = document.getElementById('newUserAdmin').value;
    
        if (!phone || !name || !password) {
            this.showNotification('error', 'Заполните все обязательные поля');
            return;
        }
    
        try {
            this.showLoading('Добавление пользователя...');
            await this.apiCall('add_user', { 
                phone: String(phone), // Сохраняем как строку
                name, 
                password, 
                department, 
                position, 
                templates, 
                admin, 
                is_active: 'TRUE' 
            });
            localStorage.removeItem('cache_Users');
            localStorage.removeItem('cache_versions');
            this.showSuccess('Пользователь успешно добавлен!');
            setTimeout(() => {
                this.showUsersManagementScreen();
            }, 2000);
        } catch (error) {
            this.hideLoading();
            this.showNotification('error', 'Ошибка добавления: ' + error.message);
        }
    }
    // Исправленный метод обновления пользователя
    async updateUser(userPhone) {
        const name = document.getElementById(`name_${userPhone}`).value;
        const password = document.getElementById(`password_${userPhone}`).value;
        const department = document.getElementById(`department_${userPhone}`).value;
        const position = document.getElementById(`position_${userPhone}`).value;
        const is_active = document.getElementById(`active_${userPhone}`).value;
        
        // Получаем выбранные шаблоны
        const templatesSelect = document.getElementById(`templates_${userPhone}`);
        const selectedTemplates = Array.from(templatesSelect.selectedOptions).map(option => option.value);
        const templates = selectedTemplates.join(', ');
        
        const admin = document.getElementById(`admin_${userPhone}`).value;
    
        try {
            this.showLoading('Обновление пользователя...');
            await this.apiCall('update_user', { 
                userPhone, 
                name, 
                password, 
                department, 
                position, 
                is_active, 
                templates, 
                admin 
            });
            localStorage.removeItem('cache_Users');
            localStorage.removeItem('cache_versions');
            this.showSuccess('Пользователь успешно обновлен!');
        } catch (error) {
            this.hideLoading();
            this.showNotification('error', 'Ошибка обновления: ' + error.message);
        }
    }

    async deleteUser(userPhone) {
        const userConfirmed = await this.showCustomConfirm('Удалить этого пользователя?');
        if (!userConfirmed) {
            return;
        }
    
        try {
            this.showLoading('Удаление пользователя...');
            await this.apiCall('delete_user', { userPhone });
            localStorage.removeItem('cache_Users');
            localStorage.removeItem('cache_versions');
            this.showSuccess('Пользователь успешно удален!');
            setTimeout(() => {
                this.showUsersManagementScreen();
            }, 2000);
        } catch (error) {
            this.showNotification('error', 'Ошибка удаления: ' + error.message);
        }
    }
    
    // Добавить товар
    async addProduct(productData) {
        try {
            this.showLoading('Добавление товара...');
            const result = await this.apiCall('add_product', productData);
            localStorage.removeItem('cache_Products');
            localStorage.removeItem('cache_ProductFormData');
            localStorage.removeItem('cache_versions');
            this.showSuccess('Товар успешно добавлен!');
            setTimeout(() => {
                this.renderScreen('main');
            }, 2000);
        } catch (error) {
            this.hideLoading();
            this.showNotification('error', 'Ошибка добавления: ' + error.message);
        }
    }
    
    // Добавить поставщика
    async addSupplier(supplierData) {
        try {
            this.showLoading('Добавление поставщика...');
            
            // Сохраняем как строки для сохранения ведущих нулей
            const data = {
                name: supplierData.name,
                tg_id: String(supplierData.tg_id || ''), // Сохраняем как строку
                phone: String(supplierData.phone) // Сохраняем как строку
            };
            
            const result = await this.apiCall('add_supplier', data);
            localStorage.removeItem('cache_Suppliers');
            localStorage.removeItem('cache_versions');
            this.showSuccess('Поставщик успешно добавлен!');
            setTimeout(() => {
                this.renderScreen('main');
            }, 2000);
        } catch (error) {
            this.hideLoading();
            this.showNotification('error', 'Ошибка добавления: ' + error.message);
        }
    }
    
    // Обработчик выбора шаблона
    handleTemplateSelect(templateName, cardElement) {
        // Анимация нажатия
        cardElement.style.transform = 'scale(0.98)';
        this.disableUI();
        setTimeout(() => {
            this.loadTemplateProducts(templateName);
        }, 150);
    }

    // Обработчик кнопки "Назад" с анимацией
    handleBackButton() {
        const button = event.currentTarget;
        
        // Анимация кнопки
        button.style.transform = 'translateX(-3px)';
        this.disableUI();
        setTimeout(() => {
            button.style.transform = '';
            this.renderScreen('main');
        }, 300);
    }
    
    // Рендер экрана создания заявки
    renderOrderCreationScreen(data) {
        if (!data || !data.products) {
            return this.renderTemplateSelectionScreen();
        }
        
        let productsHtml = '';
        
        // Группируем товары в зависимости от выбранного способа
        if (this.currentGroupBy === 'supplier') {
            productsHtml = this.renderProductsBySupplier(data.products);
        } else {
            productsHtml = this.renderProductsByTags(data.products);
        }
        
        return `
            <div class="order-screen screen-transition">
                <header class="header">
                    <button class="back-btn" onclick="app.renderScreen('template_selection')">◀️ Назад</button>
                    <h1>${data.templateName}</h1>
                </header>
                
                <!-- Toggle Switch для сортировки -->
                <div class="grouping-toggle-container">
                    <div class="toggle-switch">
                        <input type="checkbox" id="groupingToggle" class="toggle-checkbox" 
                               ${this.currentGroupBy === 'tags' ? 'checked' : ''}>
                        <label class="toggle-label" for="groupingToggle">
                            <span class="toggle-handle"></span>
                            <span class="toggle-text-supplier">📦 Поставщикам</span>
                            <span class="toggle-text-tags">🏷️ По тегам</span>
                        </label>
                    </div>
                </div>
                
                ${productsHtml}
                
                <button class="btn primary" onclick="app.submitOrder('${data.templateName}')" 
                        style="width: 100%; margin-top: 20px; padding: 15px; font-size: 18px;">
                    📨 Отправить заявку
                </button>
                
                <div id="orderStatus" class="status"></div>
            </div>
        `;
    }
    // Новый метод для обработки выхода из экрана заявки
    handleBackFromOrder() {
        // Сохраняем данные перед уходом
        this.saveCurrentFormData();
        this.renderScreen('template_selection');
    }
    // Рендер товаров по поставщикам (существующая логика)
    renderProductsBySupplier(products) {
        const groupedBySupplier = {};
        products.forEach(product => {
            if (!groupedBySupplier[product.supplier]) {
                groupedBySupplier[product.supplier] = [];
            }
            groupedBySupplier[product.supplier].push(product);
        });
        
        let productsHtml = '';
        Object.keys(groupedBySupplier).forEach(supplier => {
            productsHtml += `
                <div class="department-group">
                    <div class="department-header">${supplier}</div>
            `;
            
            groupedBySupplier[supplier].forEach(product => {
                productsHtml += this.renderProductItem(product);
            });
            
            productsHtml += `</div>`;
        });
        
        return productsHtml;
    }

    // Метод для рендера товаров по тегам
    renderProductsByTags(products) {
        // Создаем объект для группировки по тегам
        const groupedByTags = {};
        
        products.forEach(product => {
            // Получаем теги из product_tags (предполагаем, что это строка с тегами через запятую)
            const tags = product.product_tags ? 
                product.product_tags.split(',').map(tag => tag.trim()).filter(tag => tag) : 
                ['Без тега'];
            
            // Используем первый тег для группировки (по условию тег может быть только один)
            const mainTag = tags[0];
            
            if (!groupedByTags[mainTag]) {
                groupedByTags[mainTag] = [];
            }
            groupedByTags[mainTag].push(product);
        });
        
        let productsHtml = '';
        Object.keys(groupedByTags).sort().forEach(tag => {
            productsHtml += `
                <div class="department-group">
                    <div class="department-header">
                        🏷️ ${tag}
                    </div>
            `;
            
            groupedByTags[tag].forEach(product => {
                productsHtml += this.renderProductItem(product);
            });
            
            productsHtml += `</div>`;
        });
        
        return productsHtml;
    }
    // Вынесенный метод рендера одного товара (для переиспользования)
    // Улучшенная версия renderProductItem с цветовыми индикаторами
    renderProductItem(product) {
        const key = `${product.name}|${product.supplier}`;
        const savedData = this.currentOrderData[key] || {};
        const savedQuantity = savedData.quantity || 0;
        const savedComment = savedData.comment || '';
        
        // Формируем дополнительную информацию с иконками и стилями
        const additionalInfo = [];
        
        if (product.shelf_life) {
            additionalInfo.push(`
                <span class="shelf-life-indicator" title="Срок годности">
                    🕒 ${product.shelf_life}д
                </span>
            `);
        }
        
        if (product.min_stock) {
            additionalInfo.push(`
                <span class="min-stock-indicator" title="Минимальный запас">
                    📦 ${product.min_stock}
                </span>
            `);
        }
        
        // Основная информация о товаре
        const mainInfo = `${product.unit} • ${product.supplier}`;
        
        return `
            <div class="product-item">
                <div class="product-info">
                    <div class="product-name">${product.name}</div>
                    <div class="product-details" style="font-size: 12px; color: #7f8c8d;">
                        ${mainInfo}
                        ${additionalInfo.length > 0 ? 
                            `<div style="margin-top: 3px; display: flex; flex-wrap: wrap; gap: 4px;">${additionalInfo.join('')}</div>` : 
                            ''
                        }
                    </div>
                </div>
                <input type="number" 
                       class="quantity-input" 
                       min="0" 
                       value="${savedQuantity}"
                       data-product-name="${product.name}"
                       data-product-unit="${product.unit}"
                       data-supplier="${product.supplier}"
                       placeholder="0">
                <input type="text" 
                       class="comment-input" 
                       placeholder="Комментарий"
                       data-product-name="${product.name}"
                       data-supplier="${product.supplier}"
                       value="${savedComment}">
            </div>
        `;
    }
    
    // Рендер экрана истории заявок
    renderOrderHistoryScreen() {
        console.log('Rendering history screen, orders count:', this.ordersHistory.length);
        
        let ordersHtml = '';
        
        if (!this.ordersHistory || this.ordersHistory.length === 0) {
            ordersHtml = `
                <div style="text-align: center; padding: 40px; color: #7f8c8d;">
                    <div style="font-size: 3rem; margin-bottom: 20px;">📭</div>
                    <h3>Заявок пока нет</h3>
                    <p>Создайте первую заявку на главном экране</p>
                </div>
            `;
        } else {
            this.ordersHistory.forEach((order) => {
                console.log('Rendering order:', order);
                
                // Безопасное форматирование даты
                let orderDate = 'Дата неизвестна';
                let orderTime = '';
                try {
                    const date = new Date(order.date);
                    orderDate = date.toLocaleDateString('ru-RU');
                    orderTime = date.toLocaleTimeString('ru-RU', { 
                        hour: '2-digit', 
                        minute: '2-digit' 
                    });
                } catch (e) {
                    console.log('Date parsing error:', e);
                }
                
                ordersHtml += `
                    <div class="order-item ${order.status || 'sent'}" onclick="app.showOrderDetails('${order.order_id}')">
                        <div class="order-header">
                            <span class="order-id">${order.order_id || 'Без номера'}</span>
                            <span class="order-date">${orderDate}</span>
                        </div>
                        <div class="order-details">
                            <span>${order.template || 'Без шаблона'}</span>
                            <span>${order.items_count || 0} товаров</span>
                        </div>
                        <div class="order-time">${orderTime}</div>
                        <div style="margin-top: 8px; font-size: 12px; color: #27ae60;">
                            ✅ Успешно отправлена
                        </div>
                    </div>
                `;
            });
        }
        
        return `
            <div class="history-screen screen-transition">
                <header class="header">
                    <button class="back-btn" onclick="app.renderScreen('main')">◀️ Назад</button>
                    <h1>История заявок</h1>
                </header>
                
                <div class="orders-list">
                    ${ordersHtml}
                </div>
                
                <!-- Модальное окно для деталей заявки -->
                <div id="orderDetailsModal" class="modal-overlay" style="display: none;">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h2 id="modalTitle">Детали заявки</h2>
                            <button class="close-btn" onclick="app.hideOrderDetails()">×</button>
                        </div>
                        <div id="modalContent">
                            <!-- Контент будет заполнен динамически -->
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // Показать детали заявки
    showOrderDetails(orderId) {
        console.log('Showing details for order:', orderId);
        
        // Находим заявку в истории
        const order = this.ordersHistory.find(o => o.order_id === orderId);
        if (!order) {
            this.showNotification('error', 'Заявка не найдена');
            return;
        }
        
        // Форматируем дату
        let orderDate = 'Дата неизвестна';
        let orderTime = '';
        try {
            const date = new Date(order.date);
            orderDate = date.toLocaleDateString('ru-RU', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
            orderTime = date.toLocaleTimeString('ru-RU', { 
                hour: '2-digit', 
                minute: '2-digit' 
            });
        } catch (e) {
            console.log('Date parsing error:', e);
        }
        
        // Получаем детали товаров
        let itemsHtml = '';
        let totalItems = 0;
        
        try {
            // Предполагаем, что items хранится в order.items
            const items = order.items || [];
            totalItems = items.length;
            
            if (items.length === 0) {
                itemsHtml = `
                    <div class="no-items">
                        <div style="font-size: 2rem; margin-bottom: 10px;">📦</div>
                        <p>Информация о товарах недоступна</p>
                    </div>
                `;
            } else {
                items.forEach((item, index) => {
                    itemsHtml += `
                        <div class="order-detail-item">
                            <div class="order-detail-info">
                                <div class="order-detail-name">${item.product_name || 'Неизвестный товар'}</div>
                                <div class="order-detail-meta">
                                    ${item.supplier || 'Поставщик не указан'} • ${item.unit || 'шт'}
                                </div>
                                ${item.comment ? `<div class="order-detail-comment">💬 ${item.comment}</div>` : ''}
                            </div>
                            <div class="order-detail-quantity">
                                ${item.quantity || 0} ${item.unit || 'шт'}
                            </div>
                        </div>
                    `;
                });
            }
        } catch (error) {
            console.error('Error parsing order items:', error);
            itemsHtml = `
                <div class="no-items">
                    <div style="font-size: 2rem; margin-bottom: 10px;">❌</div>
                    <p>Ошибка загрузки деталей заявки</p>
                </div>
            `;
        }
        
        // Создаем содержимое модального окна
        const modalContent = `
            <div class="order-summary">
                <div class="order-summary-item">
                    <span>Номер заявки:</span>
                    <span><strong>${order.order_id}</strong></span>
                </div>
                <div class="order-summary-item">
                    <span>Шаблон:</span>
                    <span>${order.template || 'Не указан'}</span>
                </div>
                <div class="order-summary-item">
                    <span>Создал:</span>
                    <span>${order.user_name || 'Неизвестно'}</span>
                </div>
                <div class="order-summary-item">
                    <span>Дата:</span>
                    <span>${orderDate}</span>
                </div>
                <div class="order-summary-item">
                    <span>Время:</span>
                    <span>${orderTime}</span>
                </div>
                <div class="order-summary-total">
                    <span>Всего товаров:</span>
                    <span><strong>${totalItems}</strong></span>
                </div>
            </div>
            
            <div style="margin-top: 20px;">
                <h3 style="margin-bottom: 15px; color: #2c3e50;">Товары в заявке:</h3>
                <div class="order-items-list">
                    ${itemsHtml}
                </div>
            </div>
        `;
        
        // Показываем модальное окно
        const modal = document.getElementById('orderDetailsModal');
        const modalTitle = document.getElementById('modalTitle');
        const modalContentDiv = document.getElementById('modalContent');
        
        if (modal && modalTitle && modalContentDiv) {
            modalTitle.textContent = `Заявка ${order.order_id}`;
            modalContentDiv.innerHTML = modalContent;
            modal.style.display = 'flex';
            
            // Блокируем прокрутку основного контента
            document.body.style.overflow = 'hidden';
        }
    }
    
    // Скрыть модальное окно
    hideOrderDetails() {
        const modal = document.getElementById('orderDetailsModal');
        if (modal) {
            modal.style.display = 'none';
            // Восстанавливаем прокрутку
            document.body.style.overflow = 'auto';
        }
    }
    
    // Закрытие модального окна по клику на overlay
    setupModalClose() {
        const modal = document.getElementById('orderDetailsModal');
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.hideOrderDetails();
                }
            });
        }
    }
    
    // Показать уведомление (без изменений)
    showNotification(type, message) {
        // ... существующий код без изменений
    }

    // Настройка обработчиков событий
    setupEventListeners() {
        document.addEventListener('submit', (e) => {
            if (e.target.id === 'loginForm') {
                e.preventDefault();
                const phone = document.getElementById('phone').value;
                const password = document.getElementById('password').value;
                this.handleLogin(phone, password);
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
    
        // Обработчик изменения выбора тега
        document.addEventListener('change', (e) => {
            if (e.target.id === 'productTags') {
                this.handleTagSelection(e.target.value);
            }
        });
        
        // Динамическая обработка изменений чекбоксов товаров
        document.addEventListener('change', (e) => {
            if (e.target.name === 'products') {
                this.updateSelectionCount();
            }
        });
    }
    
    // Обновленный метод для настройки выбора товаров
    setupProductSelection() {
        const checkboxes = document.querySelectorAll('.product-item input[type="checkbox"]');
        checkboxes.forEach(checkbox => {
            checkbox.addEventListener('change', () => {
                this.updateSelectionCount();
            });
        });
        
        // Добавляем обработчик для чекбокса "Выбрать все"
        const selectAllCheckbox = document.getElementById('selectAllProducts');
        if (selectAllCheckbox) {
            selectAllCheckbox.addEventListener('change', () => {
                this.toggleSelectAllProducts();
            });
        }
    }
    
    // Обработчик выбора тега
    handleTagSelection(selectedValue) {
        const customTagGroup = document.getElementById('customTagGroup');
        const customTagInput = document.getElementById('customTag');
        
        if (selectedValue === '_custom') {
            customTagGroup.style.display = 'block';
            customTagInput.required = true;
        } else {
            customTagGroup.style.display = 'none';
            customTagInput.required = false;
            customTagInput.value = '';
        }
    }

    // Обработчик добавления товара
    handleAddProduct() {
        const name = document.getElementById('productName').value;
        const selectedTag = document.getElementById('productTags').value;
        const customTag = document.getElementById('customTag').value;
        const unit = document.getElementById('productUnit').value;
        const shelfLife = document.getElementById('productShelfLife').value;
        const minStock = document.getElementById('productMinStock').value;
        const supplier = document.getElementById('productSupplier').value;
    
        // Определяем итоговый тег
        let finalTag;
        if (selectedTag === '_custom') {
            if (!customTag) {
                this.showNotification('error', 'Введите новый тег');
                return;
            }
            finalTag = customTag;
        } else {
            if (!selectedTag) {
                this.showNotification('error', 'Выберите тег');
                return;
            }
            finalTag = selectedTag;
        }
    
        if (!name || !unit || !minStock || !supplier) {
            this.showNotification('error', 'Заполните все обязательные поля');
            return;
        }
    
        this.addProduct({
            name,
            product_tags: finalTag,
            unit,
            shelf_life: shelfLife,
            min_stock: minStock,
            suppliers: supplier
        });
    }
    
    // Обработчик добавления поставщика
    handleAddSupplier() {
        const name = document.getElementById('supplierName').value;
        const tgId = document.getElementById('supplierTgId').value;
        const phone = document.getElementById('supplierPhone').value;
    
        if (!name || !phone) {
            this.showNotification('error', 'Заполните все обязательные поля');
            return;
        }
    
        this.addSupplier({
            name,
            tg_id: tgId,
            phone
        });
    }
    
    initToggleSwitch() {
        const toggle = document.getElementById('groupingToggle');
        if (toggle) {
            toggle.addEventListener('change', (e) => {
                this.changeGroupBy(e.target.checked ? 'tags' : 'supplier');
            });
        }
        
        // Восстанавливаем данные формы после рендера
        setTimeout(() => {
            this.restoreFormData();
        }, 100);
    }
    // Выход из системы
    logout() {
        this.currentUser = null;
        this.ordersHistory = [];
        this.availableTemplates = [];
        this.enableUI(); // Разблокируем UI
        this.renderScreen('login');
    }
}

// Инициализация приложения
const app = new RestaurantOrderApp();








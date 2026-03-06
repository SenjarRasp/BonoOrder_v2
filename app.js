class RestaurantOrderApp {
    constructor() {
        this.basePath = window.location.pathname.includes('/BonoOrder_v2/') 
            ? '/BonoOrder_v2/' 
            : '/';

        this.cachedProducts = [];
        this.cachedSuppliers = [];
        this.cachedTemplates = [];
        this.cachedUsers = [];
        this.cachedTags = null;
        this._loadingCounter = 0;
        this._dataLoaded = false; // флаг для однократной загрузки
        this.apiUrl = 'https://script.google.com/macros/s/AKfycbw19I8NF1FQDPWiVl4XaNP8P_waWVucEuvmirRTWCCAJmXPBUAidWlXOlXB8ar3NYr6rg/exec';
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
        this._loadingHistory = false;
        this.init();
        if (this.loadUserSession()) {
          // Если есть сессия, сразу переходим на главный экран
          this.renderScreen('main');
          // Также можно проверить и восстановить черновик позже, когда пользователь захочет создать новую заявку
        }
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.ready.then(reg => {
            reg.update(); // проверяет обновления при каждой загрузке
          });
        }
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
            this.saveOrderDraft();
          }
        });
        window.addEventListener('beforeunload', () => {
          // Сохраняем черновик только если находимся на экране создания заявки
          if (this.currentScreen === 'order_creation') {
            this.saveOrderDraft();
          }
        });
    }

    // Сохранение сессии пользователя
    saveUserSession() {
      if (this.currentUser) {
        localStorage.setItem('app_currentUser', JSON.stringify(this.currentUser));
        localStorage.setItem('app_isAdmin', JSON.stringify(this.isAdmin));
        localStorage.setItem('app_isSuperAdmin', JSON.stringify(this.isSuperAdmin));
      }
    }
    
    // Загрузка сессии пользователя
    loadUserSession() {
      const userData = localStorage.getItem('app_currentUser');
      if (userData) {
        this.currentUser = JSON.parse(userData);
        this.isAdmin = JSON.parse(localStorage.getItem('app_isAdmin') || 'false');
        this.isSuperAdmin = JSON.parse(localStorage.getItem('app_isSuperAdmin') || 'false');
        return true;
      }
      return false;
    }
    
    // Сохранение черновика заявки
    saveOrderDraft() {
      if (this.currentTemplateName && Object.keys(this.currentOrderData).length > 0) {
        const draft = {
          templateName: this.currentTemplateName,
          orderData: this.currentOrderData,
          groupBy: this.currentGroupBy
        };
        localStorage.setItem('app_orderDraft', JSON.stringify(draft));
      } else {
        localStorage.removeItem('app_orderDraft');
      }
    }
    
    // Загрузка черновика заявки
    loadOrderDraft(templateName) {
      const draftJson = localStorage.getItem('app_orderDraft');
      if (!draftJson) return null;
      const draft = JSON.parse(draftJson);
      if (draft.templateName === templateName) {
        return draft;
      }
      return null;
    }
    
    // Очистка всех сохранённых данных (при логауте)
    clearAllStorage() {
      localStorage.removeItem('app_currentUser');
      localStorage.removeItem('app_isAdmin');
      localStorage.removeItem('app_isSuperAdmin');
      localStorage.removeItem('app_orderDraft');
    }

    clearUserSession() {
      localStorage.removeItem('app_currentUser');
      localStorage.removeItem('app_isAdmin');
      localStorage.removeItem('app_isSuperAdmin');
    }

    getTableChanges() {
        if (!this.table) return { updated: [], added: [], deleted: [] };
        
        // Tabulator 5: getDataChanges() возвращает объект с массивами updated, added, deleted
        if (typeof this.table.getDataChanges === 'function') {
            const changes = this.table.getDataChanges();
            // Если вернулся объект (Tabulator 5)
            if (changes && typeof changes === 'object' && !Array.isArray(changes)) {
                return changes;
            }
            // Если вернулся массив (Tabulator 4)
            if (Array.isArray(changes)) {
                const result = { updated: [], added: [], deleted: [] };
                changes.forEach(change => {
                    if (change.type === 'updated') result.updated.push(change.data);
                    else if (change.type === 'added') result.added.push(change.data);
                    else if (change.type === 'deleted') result.deleted.push(change.data);
                });
                return result;
            }
        }
        
        // Альтернативный метод для некоторых версий
        if (typeof this.table.getChanges === 'function') {
            return this.table.getChanges();
        }
        
        return { updated: [], added: [], deleted: [] };
    }
    
    async loadAllCachedData(force = false) {
      // Если уже загружено и не форсируем, выходим
      if (this._dataLoaded && !force) return;
    
      // Пробуем получить из localStorage
      const productsData = this.getCachedData('Products');
      const suppliersData = this.getCachedData('Suppliers');
      const templatesData = this.getCachedData('Templates');
    
      if (productsData && suppliersData && templatesData) {
        this.cachedProducts = productsData.products || [];
        this.cachedSuppliers = suppliersData.suppliers || [];
        this.cachedTemplates = templatesData.templates || [];
        this._dataLoaded = true;
        return;
      }
    
      // Если чего-то нет в кэше, загружаем всё с сервера
      this.showLoading('Загрузка справочников...');
      try {
        const [products, suppliers, templates] = await Promise.all([
          this.apiCall('get_all_products'),
          this.apiCall('get_all_suppliers'),
          this.apiCall('get_all_templates')
        ]);
    
        this.cachedProducts = products.products || [];
        this.cachedSuppliers = suppliers.suppliers || [];
        this.cachedTemplates = templates.templates || [];

        // Извлекаем теги из загруженных продуктов
        const tagsSet = new Set();
        this.cachedProducts.forEach(p => {
            if (p.product_tags) {
                p.product_tags.split(',').forEach(tag => {
                    tag = tag.trim();
                    if (tag) tagsSet.add(tag);
                });
            }
        });
        this.cachedTags = Array.from(tagsSet).sort();
          
        this.saveCachedData('Products', products);
        this.saveCachedData('Suppliers', suppliers);
        this.saveCachedData('Templates', templates);
        this._dataLoaded = true;
    
        this.hideLoading();
      } catch (error) {
        this.hideLoading();
        console.error('Ошибка загрузки справочников:', error);
        throw error;
      }
    }

    getSuppliersList() {
        // Извлекаем уникальные имена поставщиков из кэша
        const suppliers = this.cachedSuppliers.map(s => s.name);
        return [...new Set(suppliers)].sort();
    }
    
    showNotification(type, message, duration = 3000) {
      // Контейнер для уведомлений (создаётся при первом вызове)
      let toastContainer = document.getElementById('toast-container');
      if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'toast-container';
        toastContainer.style.cssText = `
          position: fixed;
          top: 20px;
          right: 20px;
          z-index: 10001;
          display: flex;
          flex-direction: column;
          gap: 10px;
        `;
        document.body.appendChild(toastContainer);
      }
    
      // Создание уведомления
      const toast = document.createElement('div');
      toast.className = `toast toast-${type}`;
      toast.textContent = message;
      toast.style.cssText = `
        background: ${type === 'error' ? '#f44336' : type === 'success' ? '#4caf50' : '#2196f3'};
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.2);
        opacity: 0;
        transform: translateX(100%);
        transition: all 0.3s ease;
        min-width: 200px;
        max-width: 300px;
        word-wrap: break-word;
      `;
    
      toastContainer.appendChild(toast);
    
      // Анимация появления
      setTimeout(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(0)';
      }, 10);
    
      // Автоматическое скрытие через duration
      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => {
          if (toast.parentNode) toast.remove();
          if (toastContainer.children.length === 0) toastContainer.remove();
        }, 300);
      }, duration);
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
        this.currentGroupBy = groupBy;
        // Перерисовываем экран с новым способом группировки
        this.renderScreen('order_creation', {
            templateName: this.currentTemplateName,
            products: this.currentProducts
        });
    }
     // Показать анимацию загрузки
    showLoading(text = 'Ща всё будет...') {
        this._loadingCounter++;
        if (this._loadingCounter === 1) {
            const overlay = document.getElementById('loadingOverlay');
            const loadingText = document.getElementById('loadingText');
            if (overlay && loadingText) {
                loadingText.textContent = text;
                overlay.classList.add('active');
            }
        } else {
            // просто обновляем текст
            const loadingText = document.getElementById('loadingText');
            if (loadingText) loadingText.textContent = text;
        }
    }

    // Скрыть анимацию загрузки
    hideLoading() {
        this._loadingCounter--;
        if (this._loadingCounter <= 0) {
            this._loadingCounter = 0;
            const overlay = document.getElementById('loadingOverlay');
            if (overlay) overlay.classList.remove('active');
            this.enableUI();
        }
    }
    
    isLoadingActive() {
        const overlay = document.getElementById('loadingOverlay');
        return overlay && overlay.classList.contains('active');
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
    showSuccess(message = 'Успешно!', callback = null) {
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
            
            setTimeout(() => {
                // Сначала рендерим новый экран (под overlay'ем)
                if (callback) callback();
                // Затем скрываем overlay
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
            this.disableUI();                 // блокируем UI
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
            
            await this.syncData();
            await this.loadAllCachedData();
            
            // Убедимся, что overlay активен перед приветствием
            if (!this.isLoadingActive()) {
                this.showLoading(`Добро пожаловать, ${this.currentUser.name}!`);
            } else {
                const loadingText = document.getElementById('loadingText');
                if (loadingText) loadingText.textContent = `Добро пожаловать, ${this.currentUser.name}!`;
            }
            
            // Преобразуем admin значение в строку и приводим к верхнему регистру
            const adminValue = String(this.currentUser.isAdmin).trim().toUpperCase();
            
            // Проверяем права одним условием
            this.isAdmin = (adminValue === 'TRUE' || adminValue === 'SUPER' || adminValue === '1' || adminValue === 'YES');
            this.isSuperAdmin = (adminValue === 'SUPER');

            this.saveUserSession();
            
            this.showSuccess(`Добро пожаловать, ${this.currentUser.name}!`, () => {
                this.renderScreen('main', null, true);
            });
            
        } catch (error) {
            this.hideLoading();
            this.showNotification('error', error.message);
        } finally {
            this.enableUI();               // разблокируем UI в любом случае
        }
    }

    // Загрузка доступных шаблонов
    async loadUserTemplates() {
      try {
        // Убеждаемся, что данные в памяти есть
        await this.loadAllCachedData();
    
        // Фильтруем шаблоны, доступные пользователю
        this.availableTemplates = this.cachedTemplates.filter(t =>
          this.currentUser.templates.includes(t.name)
        );
    
        this.renderScreen('template_selection');
      } catch (error) {
        this.showNotification('error', 'Ошибка загрузки шаблонов: ' + error.message);
      }
    }

    // Загрузка товаров по шаблону
    async loadTemplateProducts(templateName) {
      try {
        await this.loadAllCachedData();
    
        const template = this.cachedTemplates.find(t => t.name === templateName);
        if (!template) throw new Error('Шаблон не найден');
    
        const templateTags = template.product_tags ? template.product_tags.split(',').map(t => t.trim()) : [];
    
        const filteredProducts = [];
        this.cachedProducts.forEach(product => {
          const itemTags = product.product_tags ? product.product_tags.split(',').map(t => t.trim()) : [];
          if (itemTags.length === 0) return; // товары без тегов не включаем
    
          const hasMatchingTag = templateTags.length === 0 || itemTags.some(tag => templateTags.includes(tag));
          if (!hasMatchingTag) return;
    
          // Размножаем товар на каждого поставщика
          const suppliers = product.supplier ? product.supplier.split(',').map(s => s.trim()) : [''];
          suppliers.forEach(supplier => {
            filteredProducts.push({
              name: product.name,
              unit: product.unit || 'шт',
              pack_quantity: parseFloat(product.pack_quantity) || 1, // как число
              supplier: supplier,
              shelf_life: product.shelf_life || '',
              min_stock: product.min_stock || 0,
              product_tags: product.product_tags || ''
            });
          });
        });
    
        this.currentProducts = filteredProducts;
        this.currentTemplateName = templateName;
        const draft = this.loadOrderDraft(templateName);
        if (draft) {
          this.currentOrderData = draft.orderData;
          this.currentGroupBy = draft.groupBy;
          // При рендере экрана данные восстановятся автоматически через restoreFormData()
        }
        this.renderScreen('order_creation', { templateName, products: filteredProducts });
      } catch (error) {
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
            // Очищаем черновик
            localStorage.removeItem('app_orderDraft');
            
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
                throw new Error('Ошибка сети. Проверьте подключение к интернету.');
              }
            
            throw new Error('Ошибка соединения: ' + error.message);
        } finally {
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
    renderScreen(screenName, data = null, skipAnimation = false) {
        this.currentScreen = screenName;
        const app = document.getElementById('app');
        
        if (!skipAnimation) {
            const isBackNavigation = screenName === 'main' || screenName === 'template_selection';
            const exitAnimation = isBackNavigation ? 'screen-exit-back' : 'screen-exit';
            if (app.children.length > 0) {
                const currentScreen = app.children[0];
                currentScreen.classList.add(exitAnimation);
            }
        }
        
        const delay = skipAnimation ? 0 : 300;
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
                case 'edit_products':
                    screenHTML = this.renderEditProductsScreen();
                    break;
                case 'order_history':
                    screenHTML = this.renderOrderHistoryScreen();
                    break;
            }
            
            app.innerHTML = screenHTML;
            
            if (screenName === 'edit_products') {
                setTimeout(() => this.initProductsTable(), 100);
            }
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
            
        }, delay);
    }

    renderEditProductsScreen() {
        return `
            <div class="main-screen screen-transition">
                <header class="header">
                    <button class="back-btn" onclick="app.renderScreen('main')">◀️ Назад</button>
                    <h1>Редактирование товаров</h1>
                </header>
                <div id="products-table" style="height: 70vh; width: 100%; overflow: auto;"></div>
                <div style="display: flex; gap: 10px; margin-top: 15px;">
                    <button class="btn primary" onclick="app.saveProductsTable()">💾 Сохранить все</button>
                    <button class="btn secondary" onclick="app.addProductRow()">➕ Добавить строку</button>
                    <button class="btn" onclick="app.table.clearFilter()">🗑️ Сбросить фильтры</button>
                </div>
                <div id="editProductsStatus" class="status"></div>
            </div>
        `;
    }

    initProductsTable() {
        const container = document.getElementById('products-table');
        if (!container) return;
        window.addEventListener('resize', () => {
            if (this.table) this.table.redraw();
        });
        // Подготовка данных: преобразуем cachedProducts в формат для таблицы
        const tableData = this.cachedProducts.map(p => ({
            id: p.id,
            name: p.name || '',
            product_tags: p.product_tags || '',
            unit: p.unit || '',
            pack_quantity: p.pack_quantity || 1,
            shelf_life: p.shelf_life || '',
            min_stock: p.min_stock || 0,
            supplier: p.supplier || '',
            department: p.department || ''
        }));
    
        this.table = new Tabulator(container, {
            data: tableData,
            layout: 'fitColumns',
            placeholder: 'Нет данных',
            persistence: {
                columns: true,  // сохранять ширину и порядок колонок
                filter: true,   // (опционально) сохранять фильтры
                sort: true,     // (опционально) сохранять сортировку
            },
            persistenceID: 'products_table', // уникальный идентификатор для localStorage
            columns: [
                { title: 'ID', field: 'id', visible: false },
                { 
                    title: 'Название', 
                    field: 'name', 
                    editor: 'input', 
                    headerFilter: 'input',
                    validator: ['required', 'string']
                },
                { 
                    title: 'Теги', 
                    field: 'product_tags', 
                    editor: 'list',
                    editorParams: {
                        values: this.cachedTags || [],
                        autocomplete: true,
                        allowEmpty: true,
                        freetext: true
                    },
                    headerFilter: 'input',
                    tooltip: true 
                },
                { 
                    title: 'Ед. изм.', 
                    field: 'unit', 
                    editor: 'input', 
                    width: 80,
                    validator: ['required']
                },
                { 
                    title: 'Шаг', 
                    field: 'pack_quantity', 
                    editor: 'number', 
                    width: 70,
                    validator: ['required', 'numeric', 'min:0.01']
                },
                { 
                    title: 'Срок годности', 
                    field: 'shelf_life', 
                    editor: 'number', 
                    width: 100,
                    validator: ['numeric', 'min:0']
                },
                { 
                    title: 'Мин. запас', 
                    field: 'min_stock', 
                    editor: 'number', 
                    width: 100,
                    validator: ['required', 'numeric', 'min:0']
                },
                { 
                    title: 'Поставщики', 
                    field: 'supplier', 
                    editor: 'list',
                    editorParams: {
                        values: this.getSuppliersList(),
                        autocomplete: true,
                        allowEmpty: true,
                        freetext: true  // разрешить ввод нового значения
                    },
                    headerFilter: 'input',
                    tooltip: true 
                },
                { 
                    title: 'Департамент', 
                    field: 'department', 
                    editor: 'input', 
                    headerFilter: 'input',
                    width: 120
                },
                {
                    title: 'Действия',
                    formatter: 'buttonCross',
                    width: 70,
                    cellClick: (e, cell) => {
                        const row = cell.getRow();
                        if (confirm('Удалить строку?')) {
                            row.delete();
                        }
                    }
                }
            ],
            reactiveData: true,
            selectable: true,
            clipboard: true,                // поддержка копирования/вставки из Excel
            clipboardPasteAction: 'update', // вставленные данные обновят ячейки
            clipboardPasteParser: 'table',  // парсить как таблицу
            history: true,                   // поддержка undo/redo
            movableColumns: true,
            resizableColumns: true
        });
        window.addEventListener('resize', () => {
            if (this.table) this.table.redraw();
        });
        // Сохраняем экземпляр таблицы в app для доступа из других методов
    }

    addProductRow() {
        if (!this.table) return;
        this.table.addRow({
            id: 'new_' + Date.now(), // временный ID
            name: '',
            product_tags: '',
            unit: 'шт',
            pack_quantity: 1,
            shelf_life: '',
            min_stock: 1,
            supplier: ''
        }, true); // true - добавить в начало
    }

    async saveProductsTable() {
        if (!this.table) return;
    
        // Получаем все изменения
        const changes = this.getTableChanges();
        if (!changes.updated.length && !changes.added.length && !changes.deleted.length) {
            this.showNotification('info', 'Нет изменений для сохранения');
            return;
        }
    
        this.disableUI();
        this.showLoading('Сохранение...');
    
        try {
            // Преобразуем данные: удаляем временные ID у новых строк и готовим payload
            const payload = {
                updated: changes.updated.map(row => ({
                    id: row.id,
                    name: row.name,
                    product_tags: row.product_tags,
                    unit: row.unit,
                    pack_quantity: row.pack_quantity,
                    shelf_life: row.shelf_life,
                    min_stock: row.min_stock,
                    supplier: row.supplier,
                    department: row.department
                })),
                added: changes.added.map(row => ({
                    name: row.name,
                    product_tags: row.product_tags,
                    unit: row.unit,
                    pack_quantity: row.pack_quantity,
                    shelf_life: row.shelf_life,
                    min_stock: row.min_stock,
                    supplier: row.supplier,
                    department: row.department
                })),
                deleted: changes.deleted.map(row => row.id)
            };
    
            // Отправляем на сервер
            const result = await this.apiCall('bulk_update_products', payload);
    
            // Сброс кэша
            this.cachedProducts = [];
            this.cachedTags = null;
            this._dataLoaded = false;
            localStorage.removeItem('cache_Products');
            localStorage.removeItem('cache_ProductFormData');
            localStorage.removeItem('cache_versions');
    
            this.showSuccess('Товары сохранены!');
            setTimeout(() => {
                this.renderScreen('main');
            }, 2000);
        } catch (error) {
            this.hideLoading();
            this.showNotification('error', 'Ошибка сохранения: ' + error.message);
        } finally {
            this.enableUI();
        }
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
                        <label>Шаг упаковки *</label>
                        <input type="number" id="productPackQuantity" required min="0.1" step="0.1" value="1">
                        <small>На сколько изменяется количество при нажатии +/-</small>
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
                    
                    <div class="input-group">
                        <label>Департамент</label>
                        <input type="text" id="productDepartment" placeholder="Бар, Кухня и т.д.">
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
            <div class="action-card" onclick="app.handleMainAction('edit_products')">
                <div class="action-content">
                    <div class="action-icon">📝</div>
                    <h3>Редактировать товары</h3>
                    <p>Массовое редактирование в таблице</p>
                </div>
            </div>
            
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

    async showEditProductsScreen() {
        await this.loadAllCachedData(); // убеждаемся, что данные загружены
        this.renderScreen('edit_products');
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

                case 'edit_products':
                    this.showEditProductsScreen();
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
      // Убеждаемся, что товары загружены в память
      if (this.cachedProducts.length === 0) {
        await this.loadAllCachedData();
      }
    
      // Получаем теги из кэша (память -> localStorage -> сервер)
      let tags = this.cachedTags;
      if (!tags) {
        const formData = this.getCachedData('ProductFormData');
        if (formData && formData.tags) {
          tags = formData.tags;
          this.cachedTags = tags;
        } else {
          this.showLoading('Загрузка тегов...');
          try {
            const formData = await this.apiCall('get_product_form_data');
            tags = formData.tags || [];
            this.saveCachedData('ProductFormData', formData);
            this.cachedTags = tags;
          } catch (error) {
            console.error('Ошибка загрузки тегов:', error);
            tags = [];
          } finally {
            this.hideLoading();
          }
        }
      }
    
      this.renderScreen('delete_product', {
        products: this.cachedProducts,
        tags: tags
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
        this.disableUI();
        try {
            this.showLoading('Удаление товаров...');
            await this.apiCall('delete_products', { productIds: selectedProducts });

            this.cachedProducts = [];
            this.cachedTags = null;
            this._dataLoaded = false;
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
        this.disableUI();
        try {
            this.showLoading('Удаление поставщиков...');
            await this.apiCall('delete_suppliers', { supplierIds: selectedSuppliers });

            this.cachedSuppliers = [];
            this._dataLoaded = false;
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
        this.disableUI();
        
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
            
            this.cachedTemplates = [];
            this._dataLoaded = false;
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
        this.disableUI();
        
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
            

            this.cachedTemplates = [];
            this._dataLoaded = false;
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
        this.disableUI();
        try {
            this.showLoading('Удаление шаблона...');
            await this.apiCall('delete_template', { templateId });
            
            this.cachedTemplates = [];
            this._dataLoaded = false;
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
        this.disableUI();
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

            this.cachedUsers = [];
            this._dataLoaded = false;
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
        this.disableUI();
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

            this.cachedUsers = [];
            this._dataLoaded = false;
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
        
        this.disableUI();
        
        try {
            this.showLoading('Удаление пользователя...');
            await this.apiCall('delete_user', { userPhone });
            
            this.cachedUsers = [];
            this._dataLoaded = false;
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

            this.cachedProducts = [];
            this.cachedTags = null;
            this._dataLoaded = false;
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

            this.cachedSuppliers = [];
            this._dataLoaded = false;
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

    // Новые методы для изменения количества

    roundToStep(value, step) {
        const stepStr = step.toString();
        const decimals = stepStr.includes('.') ? stepStr.split('.')[1].length : 0;
        return parseFloat(value.toFixed(decimals));
    }
    
    incrementQuantity(productName, supplier, step) {
        const key = `${productName}|${supplier}`;
        if (!this.currentOrderData[key]) this.currentOrderData[key] = { quantity: 0, comment: '' };
        const current = this.currentOrderData[key].quantity || 0;
        let newValue = this.roundToStep(current + step, step);
        this.currentOrderData[key].quantity = newValue;
        
        // Обновляем input на странице
        const input = document.querySelector(`.quantity-input[data-product-name="${productName}"][data-supplier="${supplier}"]`);
        if (input) input.value = newValue;
        
        this.saveOrderDraft();
    }
    
    decrementQuantity(productName, supplier, step) {
        const key = `${productName}|${supplier}`;
        if (!this.currentOrderData[key]) this.currentOrderData[key] = { quantity: 0, comment: '' };
        const current = this.currentOrderData[key].quantity || 0;
        let newValue = this.roundToStep(Math.max(0, current - step), step);
        this.currentOrderData[key].quantity = newValue;
        
        const input = document.querySelector(`.quantity-input[data-product-name="${productName}"][data-supplier="${supplier}"]`);
        if (input) input.value = newValue;
        
        this.saveOrderDraft();
    }
    
    // Вынесенный метод рендера одного товара (для переиспользования)
    // Улучшенная версия renderProductItem с цветовыми индикаторами
    renderProductItem(product) {
        const key = `${product.name}|${product.supplier}`;
        const savedData = this.currentOrderData[key] || {};
        const savedQuantity = savedData.quantity || 0;
        const savedComment = savedData.comment || '';
        const step = product.pack_quantity || 1;
        
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

        // Экранируем кавычки для onclick
        const productNameEscaped = product.name.replace(/'/g, "\\'");
        const supplierEscaped = product.supplier.replace(/'/g, "\\'");
        
        return `
            <div class="product-item">
                <div class="product-info">
                    <div class="product-name">${product.name}</div>
                    <div class="product-details" style="font-size: 12px; color: #7f8c8d;">
                        ${product.unit} • ${product.supplier}
                        ${product.shelf_life ? `<span>🕒 ${product.shelf_life}д</span>` : ''}
                        ${product.min_stock ? `<span>📦 мин. ${product.min_stock}</span>` : ''}
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 4px;">
                    <button class="quantity-btn" onclick="app.decrementQuantity('${productNameEscaped}', '${supplierEscaped}', ${step})">−</button>
                    <input type="number" 
                           class="quantity-input" 
                           min="0" 
                           step="${step}"
                           value="${savedQuantity}"
                           data-product-name="${product.name}"
                           data-product-unit="${product.unit}"
                           data-supplier="${product.supplier}"
                           placeholder="0">
                    <button class="quantity-btn" onclick="app.incrementQuantity('${productNameEscaped}', '${supplierEscaped}', ${step})">+</button>
                </div>
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
        const packQuantity = document.getElementById('productPackQuantity').value;
        const shelfLife = document.getElementById('productShelfLife').value;
        const minStock = document.getElementById('productMinStock').value;
        const supplier = document.getElementById('productSupplier').value;
        const department = document.getElementById('productDepartment').value;
    
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
            pack_quantity: packQuantity || '1',
            shelf_life: shelfLife,
            min_stock: minStock,
            suppliers: supplier,
            department: department
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
        this.hideLoading(); 
        this.clearUserSession();
        this.currentUser = null;
        this.ordersHistory = [];
        this.availableTemplates = [];
        this.cachedProducts = [];
        this.cachedTags = null;
        this.cachedSuppliers = [];
        this.cachedTemplates = [];
        this.cachedUsers = [];
        this._dataLoaded = false;
        this.enableUI(); // Разблокируем UI
        this.renderScreen('login');
    }
}

// Инициализация приложения
const app = new RestaurantOrderApp();






































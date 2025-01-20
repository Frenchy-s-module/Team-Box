import { TeamBox } from '../team-box.js';
import { TeamBoxThemeManager } from '../themes/theme-manager.js';
import { TeamBoxSocket } from '../socket.js';

export class TeamBoxApp extends Application {
    static get defaultOptions() {
        console.log(`${TeamBox.ID} | TeamBoxApp | Initializing defaultOptions`);
        return mergeObject(super.defaultOptions, {
            id: 'team-box-inventory',
            classes: ['team-box'],
            template: 'modules/team-box/templates/inventory.html',
            width: 800,
            height: 600,
            minimizable: true,
            resizable: true,
            title: game.i18n.localize('TEAMBOX.Title')
        });
    }

    getData(options = {}) {
        console.log(`${TeamBox.ID} | TeamBoxApp | Getting data`);
        const inventory = this._inventory || game.settings.get(TeamBox.ID, TeamBox.FLAGS.INVENTORY) || [];
        console.log(`${TeamBox.ID} | TeamBoxApp | Current inventory:`, inventory);
        
        const isGM = game.user.isGM;
        console.log(`${TeamBox.ID} | TeamBoxApp | Is GM:`, isGM);

        // Récupérer les types uniques présents dans l'inventaire
        const uniqueTypes = [...new Set(inventory.map(item => item.type))];
        console.log(`${TeamBox.ID} | TeamBoxApp | Unique item types in inventory:`, uniqueTypes);

        // Créer un objet pour stocker les types présents
        const hasTypes = {};
        uniqueTypes.forEach(type => {
            // Convertir le type en clé de filtre (lowercase et sans espaces)
            const filterKey = type.toLowerCase().replace(/\s+/g, '');
            hasTypes[`has${type.charAt(0).toUpperCase() + type.slice(1)}`] = true;
        });

        console.log(`${TeamBox.ID} | TeamBoxApp | Has types:`, hasTypes);

        // Get the current filter
        const currentFilter = this._filter || 'all';

        // Filter items based on type
        const filteredItems = this._filterItems(inventory, currentFilter);
        
        // Créer un objet d'icônes dynamique basé sur les types présents
        const itemTypeIcons = {};
        uniqueTypes.forEach(type => {
            const lcType = type.toLowerCase();
            // Définir une icône par défaut ou spécifique selon le type
            if (lcType.includes('weapon')) itemTypeIcons[type] = 'sword';
            else if (lcType.includes('armor')) itemTypeIcons[type] = 'shield-alt';
            else if (lcType.includes('equipment')) itemTypeIcons[type] = 'toolbox';
            else if (lcType.includes('consumable')) itemTypeIcons[type] = 'flask';
            else if (lcType.includes('tool')) itemTypeIcons[type] = 'tools';
            else if (lcType.includes('spell')) itemTypeIcons[type] = 'magic';
            else if (lcType.includes('feat')) itemTypeIcons[type] = 'star';
            else if (lcType.includes('currency')) itemTypeIcons[type] = 'coins';
            else if (lcType.includes('container')) itemTypeIcons[type] = 'box';
            else if (lcType.includes('loot')) itemTypeIcons[type] = 'gem';
            else itemTypeIcons[type] = 'circle'; // Icône par défaut
        });

        return {
            inventory: filteredItems,
            isGM,
            itemTypeIcons,
            uniqueTypes, // Ajouter les types uniques pour le template
            currentFilter,
            ...hasTypes // Spread tous les "hasTypes" dans l'objet retourné
        };
    }

    activateListeners(html) {
        console.log(`${TeamBox.ID} | TeamBoxApp | Activating listeners`);
        super.activateListeners(html);

        // Gestion du drag & drop
        this._setupDropZone(html.find('.drop-zone')[0]);

        // Bouton Supprimer tout
        if (game.user.isGM) {
            html.find('.delete-all').click(ev => this._onDeleteAll(ev));
        }

        // Filtres
        html.find('.filter-btn').click(event => {
            const filterType = $(event.currentTarget).data('filter');
            console.log(`${TeamBox.ID} | TeamBoxApp | Filter clicked:`, filterType);
            this._filter = filterType;
            this.render(true);
        });

        // Boutons de contrôle des items
        if (game.user.isGM) {
            html.find('.edit').click(ev => this._onEditItem(ev));
            html.find('.give').click(ev => this._onGiveItem(ev));
            html.find('.delete').click(ev => this._onDeleteItem(ev));
        } else {
            html.find('.take').click(ev => this._onTakeItem(ev));
        }

        // Gestion de la quantité
        html.find('.quantity-btn').click(event => {
            const btn = $(event.currentTarget);
            const item = btn.closest('.item');
            const itemId = item.data('item-id');
            const currentQty = parseInt(item.find('.item-quantity').text());
            const isIncrease = btn.hasClass('increase-quantity');
            
            const newQty = isIncrease ? currentQty + 1 : Math.max(1, currentQty - 1);
            
            if (game.user.isGM) {
                TeamBox.updateItem(itemId, { quantity: newQty });
            } else {
                TeamBoxSocket.requestUpdateQuantity(itemId, newQty);
            }
        });
    }

    _setupDropZone(dropZone) {
        if (!dropZone) return;

        dropZone.addEventListener('dragover', (event) => {
            event.preventDefault();
            event.currentTarget.classList.add('dragover');
        });

        dropZone.addEventListener('dragleave', (event) => {
            event.preventDefault();
            event.currentTarget.classList.remove('dragover');
        });

        dropZone.addEventListener('drop', async (event) => {
            event.preventDefault();
            event.currentTarget.classList.remove('dragover');

            try {
                const data = JSON.parse(event.dataTransfer.getData('text/plain'));
                console.log(`${TeamBox.ID} | TeamBoxApp | Dropped data:`, data);

                if (data.type === 'Item') {
                    const item = await fromUuid(data.uuid);
                    if (!item) {
                        console.error(`${TeamBox.ID} | TeamBoxApp | Item not found:`, data.uuid);
                        return ui.notifications.error(game.i18n.localize('TEAMBOX.Notifications.ItemNotFound'));
                    }

                    console.log(`${TeamBox.ID} | TeamBoxApp | Adding item:`, item);
                    TeamBoxSocket.requestAddItem(item.toObject());
                }
            } catch (error) {
                console.error(`${TeamBox.ID} | TeamBoxApp | Error processing drop:`, error);
                ui.notifications.error(game.i18n.localize('TEAMBOX.Notifications.ErrorProcessingDrop'));
            }
        });
    }

    _filterItems(items, filter) {
        console.log(`${TeamBox.ID} | TeamBoxApp | Filtering items by:`, filter);
        if (!items || !Array.isArray(items)) return [];
        if (filter === 'all') return items;

        return items.filter(item => {
            const itemType = item.type.toLowerCase();
            return itemType === filter.toLowerCase();
        });
    }

    async _onAddItem(event) {
        console.log(`${TeamBox.ID} | TeamBoxApp | Adding new item`);
        event.preventDefault();
        const itemData = {
            id: randomID(),
            name: 'New Item',
            description: '',
            quantity: 1,
            owner: game.user.name
        };
        console.log(`${TeamBox.ID} | TeamBoxApp | New item data:`, itemData);
        if (game.user.isGM) {
            await TeamBox.addItem(itemData);
        } else {
            TeamBoxSocket.requestAddItem(itemData);
        }
        this.render();
    }

    async _onTakeItem(event) {
        event.preventDefault();
        const itemId = event.currentTarget.closest('.item').dataset.itemId;
        if (game.user.isGM) {
            await this._handleTakeItem(itemId);
        } else {
            TeamBoxSocket.requestTakeItem(itemId);
            ui.notifications.info(game.i18n.localize('TEAMBOX.Notifications.ItemRequested'));
        }
    }

    async _handleTakeItem(itemId) {
        const inventory = game.settings.get(TeamBox.ID, TeamBox.FLAGS.INVENTORY) || [];
        const item = inventory.find(i => i.uuid === itemId);
        
        if (!item) return;

        // Create a copy of the item for the player
        const playerItem = duplicate(item);
        playerItem.uuid = randomID();
        playerItem.owner = game.user.name;
        playerItem.quantity = 1;

        // Decrease quantity or remove original item
        if (item.quantity > 1) {
            item.quantity--;
            await TeamBox.updateItem(itemId, { quantity: item.quantity });
        } else {
            await TeamBox.removeItem(itemId);
        }

        // Add item to player
        await TeamBox.addItem(playerItem);
        ui.notifications.info(game.i18n.format('TEAMBOX.Notifications.ItemTaken', { name: item.name }));
    }

    async _onGiveItem(event) {
        event.preventDefault();
        const itemId = event.currentTarget.closest('.item').dataset.itemId;
        const inventory = game.settings.get(TeamBox.ID, TeamBox.FLAGS.INVENTORY) || [];
        const item = inventory.find(i => i.uuid === itemId);
        
        if (!item) return;

        const tokens = canvas.tokens.placeables.filter(t => t.actor);
        if (!tokens.length) {
            ui.notifications.warn(game.i18n.localize('TEAMBOX.Errors.NoTokens'));
            return;
        }

        const tokenChoices = tokens.reduce((acc, t) => {
            acc[t.id] = t.name;
            return acc;
        }, {});

        const content = `
            <form>
                <div class="form-group">
                    <label>${game.i18n.localize('TEAMBOX.Dialogs.Give.Token')} :</label>
                    <select name="tokenId" required>
                        ${Object.entries(tokenChoices).map(([id, name]) => `
                            <option value="${id}">${name}</option>
                        `).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>${game.i18n.localize('TEAMBOX.Dialogs.Give.Quantity')} :</label>
                    <input type="number" name="quantity" value="1" min="1" max="${item.quantity}" required>
                </div>
            </form>
        `;

        const dialog = new Dialog({
            title: game.i18n.localize('TEAMBOX.Controls.Give'),
            content: content,
            buttons: {
                give: {
                    icon: '<i class="fas fa-gift"></i>',
                    label: game.i18n.localize('TEAMBOX.Controls.Give'),
                    callback: async (html) => {
                        const form = html.find('form')[0];
                        const tokenId = form.tokenId.value;
                        const quantity = parseInt(form.quantity.value);
                        
                        if (quantity > 0 && quantity <= item.quantity) {
                            if (game.user.isGM) {
                                const token = canvas.tokens.get(tokenId);
                                if (!token?.actor) return;
                                
                                const itemData = duplicate(item);
                                itemData.system = itemData.system || {};
                                itemData.system.quantity = quantity;
                                
                                await token.actor.createEmbeddedDocuments('Item', [itemData]);

                                if (quantity === item.quantity) {
                                    await TeamBox.removeItem(itemId);
                                } else {
                                    await TeamBox.updateItem(itemId, { quantity: item.quantity - quantity });
                                }
                            } else {
                                TeamBoxSocket.requestGiveItem(itemId, tokenId, quantity);
                            }
                        }
                    }
                },
                cancel: {
                    icon: '<i class="fas fa-times"></i>',
                    label: game.i18n.localize('TEAMBOX.Controls.Cancel')
                }
            },
            default: 'give'
        });
        dialog.render(true);
    }

    async _onDeleteItem(event) {
        event.preventDefault();
        const itemId = event.currentTarget.closest('.item').dataset.itemId;
        
        if (game.user.isGM) {
            await TeamBox.removeItem(itemId);
        } else {
            TeamBoxSocket.requestDeleteItem(itemId);
        }
    }

    async _onEditItem(event) {
        console.log(`${TeamBox.ID} | TeamBoxApp | Editing item`);
        event.preventDefault();
        const itemId = event.currentTarget.closest('.item').dataset.itemId;
        const inventory = game.settings.get(TeamBox.ID, TeamBox.FLAGS.INVENTORY) || [];
        const item = inventory.find(i => i.uuid === itemId);
        console.log(`${TeamBox.ID} | TeamBoxApp | Item to edit:`, item);
        
        if (!item) return;

        const content = `
            <form>
                <div class="form-group">
                    <label>${game.i18n.localize('TEAMBOX.Dialogs.Edit.Quantity')} :</label>
                    <input type="number" name="quantity" value="${item.quantity}" min="1">
                </div>
            </form>
        `;

        const dialog = new Dialog({
            title: game.i18n.localize('TEAMBOX.Controls.Edit'),
            content: content,
            buttons: {
                confirm: {
                    icon: '<i class="fas fa-check"></i>',
                    label: game.i18n.localize('TEAMBOX.Controls.Confirm'),
                    callback: async (html) => {
                        const form = html.find('form')[0];
                        const quantity = parseInt(form.quantity.value);
                        if (quantity > 0) {
                            if (game.user.isGM) {
                                await TeamBox.updateItem(itemId, { quantity });
                            } else {
                                TeamBoxSocket.requestUpdateQuantity(itemId, quantity);
                            }
                        }
                    }
                },
                cancel: {
                    icon: '<i class="fas fa-times"></i>',
                    label: game.i18n.localize('TEAMBOX.Controls.Cancel')
                }
            },
            default: 'confirm'
        });
        dialog.render(true);
    }

    async _onItemContextMenu(event) {
        event.preventDefault();
        
        const itemElement = event.currentTarget.closest('.item');
        const itemId = itemElement.dataset.itemId;
        const inventory = game.settings.get(TeamBox.ID, TeamBox.FLAGS.INVENTORY) || [];
        const item = inventory.find(i => i.uuid === itemId);
        
        if (!item) return;

        // Get list of active players
        const players = game.users.filter(u => u.active && !u.isGM);
        
        // Create menu options
        const menuItems = [];
        
        // Add option to send to team inventory if item is not already there
        if (item.owner !== 'team') {
            menuItems.push({
                name: game.i18n.localize('TEAMBOX.Controls.SendToTeam'),
                icon: '<i class="fas fa-users"></i>',
                callback: () => this._sendItemTo(item, 'team')
            });
        }
        
        // Add options to send to each player
        players.forEach(player => {
            if (player.name !== item.owner) {
                menuItems.push({
                    name: game.i18n.format('TEAMBOX.Controls.SendToPlayer', { player: player.name }),
                    icon: '<i class="fas fa-user"></i>',
                    callback: () => this._sendItemTo(item, player.name)
                });
            }
        });
        
        // Show context menu
        if (menuItems.length) {
            new ContextMenu($(event.currentTarget), menuItems).render(event);
        }
    }

    async _sendItemTo(item, recipient) {
        console.log(`${TeamBox.ID} | TeamBoxApp | Sending item to ${recipient}:`, item);
        
        const updates = {
            owner: recipient
        };
        
        if (game.user.isGM) {
            await TeamBox.updateItem(item.uuid, updates);
        } else {
            TeamBoxSocket.requestUpdateOwner(item.uuid, recipient);
        }
        ui.notifications.info(game.i18n.format('TEAMBOX.Notifications.ItemSent', { 
            item: item.name,
            recipient: recipient 
        }));
    }

    static get instance() {
        return game.teamBox?.inventory;
    }

    static show() {
        if (!game.teamBox) game.teamBox = {};
        
        // Si une instance existe déjà, la réactiver au lieu d'en créer une nouvelle
        if (game.teamBox.inventory) {
            game.teamBox.inventory.render(true);
            game.teamBox.inventory.bringToTop();
        } else {
            game.teamBox.inventory = new this();
            game.teamBox.inventory.render(true);
        }
        return game.teamBox.inventory;
    }

    async _onDrop(event) {
        console.log(`${TeamBox.ID} | TeamBoxApp | Processing dropped item:`, event);
        
        try {
            event.preventDefault();
            
            // Get the dropped data
            let data;
            try {
                if (event.dataTransfer && event.dataTransfer.getData('text/plain')) {
                    data = JSON.parse(event.dataTransfer.getData('text/plain'));
                } else if (event.originalEvent?.dataTransfer?.getData('text/plain')) {
                    data = JSON.parse(event.originalEvent.dataTransfer.getData('text/plain'));
                } else {
                    console.error(`${TeamBox.ID} | TeamBoxApp | No valid drop data found`);
                    return false;
                }
                console.log(`${TeamBox.ID} | TeamBoxApp | Parsed drop data:`, data);
            } catch (error) {
                console.error(`${TeamBox.ID} | TeamBoxApp | Error parsing drop data:`, error);
                return false;
            }
            
            // Vérifier si c'est un item
            if (!data.type || data.type !== 'Item') {
                console.warn(`${TeamBox.ID} | TeamBoxApp | Invalid drop type:`, data.type);
                return false;
            }
            
            // Get the item from the game
            let item;
            try {
                item = await fromUuid(data.uuid);
                if (!item) {
                    console.warn(`${TeamBox.ID} | TeamBoxApp | Item not found:`, data.uuid);
                    return false;
                }
                console.log(`${TeamBox.ID} | TeamBoxApp | Retrieved item:`, item);
                console.log(`${TeamBox.ID} | TeamBoxApp | Item type:`, item.type);
                console.log(`${TeamBox.ID} | TeamBoxApp | Item full data:`, item.toObject());
            } catch (error) {
                console.error(`${TeamBox.ID} | TeamBoxApp | Error getting item:`, error);
                return false;
            }

            // Get item data safely
            let itemData;
            try {
                itemData = item.toObject();
                console.log(`${TeamBox.ID} | TeamBoxApp | Processed item data:`, itemData);
                console.log(`${TeamBox.ID} | TeamBoxApp | Item type from processed data:`, itemData.type);
            } catch (error) {
                console.error(`${TeamBox.ID} | TeamBoxApp | Error getting item data:`, error);
                // Fallback to basic item data if toObject fails
                itemData = {
                    name: item.name,
                    type: item.type,
                    img: item.img,
                    system: item.system
                };
                console.log(`${TeamBox.ID} | TeamBoxApp | Fallback item data:`, itemData);
            }

            // Add the item to inventory
            const inventory = game.settings.get(TeamBox.ID, TeamBox.FLAGS.INVENTORY) || [];
            
            // Check if item already exists
            const existingItem = inventory.find(i => i.uuid === data.uuid);
            if (existingItem) {
                existingItem.quantity = (existingItem.quantity || 1) + 1;
                console.log(`${TeamBox.ID} | TeamBoxApp | Updated existing item quantity:`, existingItem);
            } else {
                // Add new item with quantity 1
                const newItem = {
                    ...itemData,
                    uuid: data.uuid,
                    quantity: 1
                };
                inventory.push(newItem);
                console.log(`${TeamBox.ID} | TeamBoxApp | Added new item:`, newItem);
            }
            
            if (game.user.isGM) {
                await game.settings.set(TeamBox.ID, TeamBox.FLAGS.INVENTORY, inventory);
            } else {
                TeamBoxSocket.requestAddItemToInventory(newItem);
            }
            ui.notifications.info(game.i18n.format("TEAMBOX.Notifications.ItemAdded"));
            
            this.render();
            return true;
            
        } catch (error) {
            console.error(`${TeamBox.ID} | TeamBoxApp | Error processing drop:`, error);
            return false;
        }
    }

    render(force = false, options = {}) {
        console.log(`${TeamBox.ID} | TeamBoxApp | Rendering application`);
        
        // Si une mise à jour est déjà en cours, on la reporte
        if (this._pendingRender && !force) {
            return;
        }

        // Marquer qu'une mise à jour est en cours
        this._pendingRender = true;

        // Utiliser requestAnimationFrame pour regrouper les mises à jour
        window.requestAnimationFrame(() => {
            super.render(force, options);
            this._pendingRender = false;
        });
    }

    async _render(force = false, options = {}) {
        console.log(`${TeamBox.ID} | TeamBoxApp | Rendering application`);
        await super._render(force, options);
        
        // Appliquer le thème après le rendu
        const currentTheme = game.settings.get('team-box', 'theme') || 'default';
        console.log(`${TeamBox.ID} | TeamBoxApp | Applying theme after render:`, currentTheme);
        TeamBoxThemeManager.applyTheme(currentTheme);
    }

    close(options = {}) {
        if (game.teamBox?.inventory === this) {
            game.teamBox.inventory = null;
        }
        return super.close(options);
    }

    updateDisplay(inventory) {
        console.log(`${TeamBox.ID} | TeamBoxApp | Updating display with:`, inventory);
        this._inventory = inventory;
        this.render(true);
    }

    async _onDeleteAll(event) {
        event.preventDefault();

        // Créer une boîte de dialogue de confirmation
        const dialog = new Dialog({
            title: game.i18n.localize('TEAMBOX.Dialogs.DeleteAll.Title'),
            content: game.i18n.localize('TEAMBOX.Dialogs.DeleteAll.Content'),
            buttons: {
                delete: {
                    icon: '<i class="fas fa-trash"></i>',
                    label: game.i18n.localize('TEAMBOX.Controls.Delete'),
                    callback: async () => {
                        if (game.user.isGM) {
                            await game.settings.set(TeamBox.ID, TeamBox.FLAGS.INVENTORY, []);
                            this.render(true);
                            ui.notifications.info(game.i18n.localize('TEAMBOX.Notifications.AllItemsDeleted'));
                        }
                    }
                },
                cancel: {
                    icon: '<i class="fas fa-times"></i>',
                    label: game.i18n.localize('TEAMBOX.Controls.Cancel')
                }
            },
            default: 'cancel'
        });
        dialog.render(true);
    }
}

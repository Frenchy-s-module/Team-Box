import { TeamBox } from './team-box.js';

export class TeamBoxSocket {
    static initialize() {
        try {
            console.log(`${TeamBox.ID} | Socket | Initializing`);
            
            if (!game.socket) {
                console.warn(`${TeamBox.ID} | Socket | Game socket not available`);
                return;
            }

            game.socket.on(`module.${TeamBox.ID}`, (data) => {
                try {
                    console.log(`${TeamBox.ID} | Socket | Message received:`, data);
                    this._onSocketMessage(data);
                } catch (error) {
                    console.error(`${TeamBox.ID} | Socket | Error processing message:`, error);
                }
            });
        } catch (error) {
            console.error(`${TeamBox.ID} | Socket | Error during initialization:`, error);
        }
    }

    static _onSocketMessage(message) {
        if (!message.type) {
            console.warn(`${TeamBox.ID} | Socket | Invalid message received:`, message);
            return;
        }

        // Traitement des messages pour tous les clients
        switch (message.type) {
            case 'updateQuantity':
                this._handleQuantityUpdate(message.data);
                break;
            case 'itemRemoved':
                this._handleItemRemoved(message.data);
                break;
            case 'itemAdded':
                this._handleItemAdded(message.data);
                break;
            case 'inventoryUpdated':
                this._handleInventoryUpdate(message.data);
                break;
        }

        // Messages réservés au MJ
        if (game.user.isGM) {
            switch (message.type) {
                case 'requestAddItem':
                    this._handleAddItemRequest(message.data);
                    break;
                case 'requestUpdateQuantity':
                    this._handleQuantityUpdateRequest(message.data);
                    break;
                case 'requestDeleteItem':
                    this._handleDeleteItemRequest(message.data);
                    break;
                case 'requestTakeItem':
                    this._handleTakeItemRequest(message.data);
                    break;
            }
        }
    }

    static _handleQuantityUpdate(data) {
        const { itemId, quantity } = data;
        console.log(`${TeamBox.ID} | Socket | Handling quantity update:`, { itemId, quantity });
        
        // Mettre à jour l'interface uniquement
        if (game.teamBox?.inventory) {
            const inventory = game.settings.get(TeamBox.ID, TeamBox.FLAGS.INVENTORY) || [];
            const updatedInventory = inventory.map(item => {
                if (item.uuid === itemId) {
                    return { ...item, quantity };
                }
                return item;
            });
            
            // Mettre à jour l'affichage sans modifier les settings
            game.teamBox.inventory.updateDisplay(updatedInventory);
        }
    }

    static _handleQuantityUpdateRequest(data) {
        const { itemId, quantity } = data;
        console.log(`${TeamBox.ID} | Socket | Processing quantity update request:`, { itemId, quantity });
        
        // Mettre à jour la quantité
        TeamBox.updateItem(itemId, { quantity });
        
        // Notifier tous les clients
        this.notifyQuantityUpdate(itemId, quantity);
    }

    static requestUpdateQuantity(itemId, quantity) {
        console.log(`${TeamBox.ID} | Socket | Requesting quantity update:`, { itemId, quantity });
        
        if (game.user.isGM) {
            // Le MJ peut mettre à jour directement
            TeamBox.updateItem(itemId, { quantity });
            this.notifyQuantityUpdate(itemId, quantity);
        } else {
            // Les joueurs envoient une demande au MJ
            game.socket.emit(`module.${TeamBox.ID}`, {
                type: 'requestUpdateQuantity',
                data: { itemId, quantity }
            });
        }
    }

    static notifyQuantityUpdate(itemId, quantity) {
        console.log(`${TeamBox.ID} | Socket | Notifying quantity update:`, { itemId, quantity });
        
        game.socket.emit(`module.${TeamBox.ID}`, {
            type: 'updateQuantity',
            data: { itemId, quantity }
        });
    }

    static async _handleTakeItemRequest(data) {
        console.log(`${TeamBox.ID} | Socket | Handling take item request:`, data);
        if (!game.user.isGM) return;
        
        const { itemId, playerId } = data;
        const inventory = game.settings.get(TeamBox.ID, TeamBox.FLAGS.INVENTORY) || [];
        const item = inventory.find(i => i._id === itemId || i.uuid === itemId);
        
        if (!item) {
            console.warn(`${TeamBox.ID} | Socket | Item not found:`, itemId);
            return;
        }

        const player = game.users.get(playerId);
        if (!player) return;

        // Trouver le token contrôlé par le joueur
        const playerToken = canvas.tokens.placeables.find(t => t.actor && t.actor.isOwner && t.actor.hasPlayerOwner && t.actor.ownership[playerId] === 3);
        if (!playerToken) {
            ui.notifications.warn(game.i18n.localize('TEAMBOX.Errors.NoTokens'));
            return;
        }

        // Créer la boîte de dialogue de confirmation avec champ de quantité
        const content = `
            <form>
                <div class="form-group">
                    <label>${game.i18n.format('TEAMBOX.Dialogs.TakeRequest.Content', {
                        player: player.name,
                        item: item.name
                    })}</label>
                </div>
                <div class="form-group">
                    <label>${game.i18n.localize('TEAMBOX.Dialogs.Give.Quantity')}</label>
                    <div class="form-fields">
                        <input type="number" name="quantity" value="1" min="1" max="${item.quantity || 1}">
                    </div>
                </div>
            </form>`;

        const dialog = new Dialog({
            title: game.i18n.localize('TEAMBOX.Dialogs.TakeRequest.Title'),
            content: content,
            buttons: {
                confirm: {
                    icon: '<i class="fas fa-check"></i>',
                    label: game.i18n.localize('TEAMBOX.Dialogs.TakeRequest.Confirm'),
                    callback: async (html) => {
                        try {
                            const requestedQuantity = Math.min(
                                Math.max(1, parseInt(html.find('[name="quantity"]').val()) || 1),
                                item.quantity || 1
                            );

                            // Créer une copie de l'item pour le token du joueur
                            const itemData = duplicate(item);
                            delete itemData._id;
                            delete itemData.uuid;
                            
                            // S'assurer que la structure de données est correcte pour Alien RPG
                            itemData.system = itemData.system || {};
                            itemData.system.quantity = requestedQuantity;
                            
                            // Ajouter l'item au token du joueur
                            const newItems = await playerToken.actor.createEmbeddedDocuments('Item', [itemData]);
                            
                            if (newItems && newItems.length > 0) {
                                // Mettre à jour ou supprimer l'item original
                                if (item.quantity > requestedQuantity) {
                                    await TeamBox.updateItem(itemId, { quantity: item.quantity - requestedQuantity });
                                } else {
                                    await TeamBox.removeItem(itemId);
                                }

                                // Notifier tous les clients
                                this.notifyInventoryUpdate();
                                
                                // Envoyer une notification au joueur
                                ui.notifications.info(game.i18n.format('TEAMBOX.Notifications.ItemRequestAccepted', { 
                                    item: item.name
                                }));
                            } else {
                                throw new Error("Failed to create item");
                            }
                        } catch (error) {
                            console.error(`${TeamBox.ID} | Socket | Error creating item:`, error);
                            ui.notifications.error(game.i18n.localize('TEAMBOX.Errors.AddFailed'));
                        }
                    }
                },
                cancel: {
                    icon: '<i class="fas fa-times"></i>',
                    label: game.i18n.localize('TEAMBOX.Dialogs.TakeRequest.Cancel'),
                    callback: () => {
                        ui.notifications.info(game.i18n.format('TEAMBOX.Notifications.ItemRequestDenied', { 
                            item: item.name
                        }));
                    }
                }
            },
            default: 'confirm'
        });
        dialog.render(true);
    }

    static async _handleGiveItemRequest(data) {
        console.log(`${TeamBox.ID} | Socket | Handling give item request:`, data);
        if (!game.user.isGM) return;
        
        const { itemId, tokenId, quantity } = data;
        const inventory = game.settings.get(TeamBox.ID, TeamBox.FLAGS.INVENTORY) || [];
        const item = inventory.find(i => i._id === itemId);
        
        if (!item) {
            console.warn(`${TeamBox.ID} | Socket | Item not found:`, itemId);
            return;
        }

        const token = canvas.tokens.get(tokenId);
        if (!token?.actor) {
            console.warn(`${TeamBox.ID} | Socket | Token or actor not found:`, tokenId);
            return;
        }

        console.log(`${TeamBox.ID} | Socket | Found item and token:`, { item, token });

        // Create the item in token's inventory
        const itemData = duplicate(item);
        itemData.system = itemData.system || {};
        itemData.system.quantity = quantity;
        
        await token.actor.createEmbeddedDocuments('Item', [itemData]);

        // Update or remove original item
        if (quantity === item.quantity) {
            console.log(`${TeamBox.ID} | Socket | Removing original item`);
            await TeamBox.removeItem(itemId);
        } else {
            console.log(`${TeamBox.ID} | Socket | Updating original item quantity:`, item.quantity - quantity);
            await TeamBox.updateItem(itemId, { quantity: item.quantity - quantity });
        }

        // Notify all clients
        this.notifyInventoryUpdate();
    }

    static _handleItemRemoved(data) {
        const { itemId } = data;
        console.log(`${TeamBox.ID} | Socket | Handling item removed:`, itemId);
        
        // Mettre à jour l'interface uniquement
        if (game.teamBox?.inventory) {
            const inventory = game.settings.get(TeamBox.ID, TeamBox.FLAGS.INVENTORY) || [];
            const updatedInventory = inventory.filter(item => item.uuid !== itemId);
            
            // Mettre à jour l'affichage sans modifier les settings
            game.teamBox.inventory.updateDisplay(updatedInventory);
        }
    }

    static _handleDeleteItemRequest(data) {
        const { itemId } = data;
        console.log(`${TeamBox.ID} | Socket | Processing delete item request:`, itemId);
        
        // Supprimer l'item
        TeamBox.removeItem(itemId);
        
        // Notifier tous les clients
        this.notifyItemRemoved(itemId);
    }

    static notifyItemRemoved(itemId) {
        console.log(`${TeamBox.ID} | Socket | Notifying item removed:`, itemId);
        
        game.socket.emit(`module.${TeamBox.ID}`, {
            type: 'itemRemoved',
            data: { itemId }
        });
    }

    static _handleInventoryUpdate(data) {
        console.log(`${TeamBox.ID} | Socket | Handling inventory update:`, data);
        // Force a re-render of any open inventory windows
        const app = game.teamBox?.inventory;
        if (app) {
            console.log(`${TeamBox.ID} | Socket | Re-rendering inventory window`);
            app.render(true);
        }
    }

    // Méthode pour notifier tous les clients d'une mise à jour
    static notifyInventoryUpdate() {
        console.log(`${TeamBox.ID} | Socket | Notifying inventory update`);
        game.socket.emit(`module.${TeamBox.ID}`, {
            type: 'inventoryUpdated',
            data: { timestamp: Date.now() }
        });
        
        // Le GM met également à jour son propre affichage
        if (game.user.isGM) {
            this._handleInventoryUpdate({ timestamp: Date.now() });
        }
    }

    // Méthodes pour envoyer des requêtes
    static requestTakeItem(itemId) {
        console.log(`${TeamBox.ID} | Socket | Sending take item request:`, itemId);
        
        if (game.user.isGM) {
            // Le MJ peut prendre directement
            this._handleTakeItem(itemId);
        } else {
            // Les joueurs envoient une demande au MJ
            game.socket.emit(`module.${TeamBox.ID}`, {
                type: 'requestTakeItem',
                data: { 
                    itemId,
                    playerId: game.user.id
                }
            });
        }
    }

    static requestGiveItem(itemId, tokenId, quantity) {
        console.log(`${TeamBox.ID} | Socket | Sending give item request:`, { itemId, tokenId, quantity });
        game.socket.emit(`module.${TeamBox.ID}`, {
            type: 'requestGiveItem',
            data: { itemId, tokenId, quantity }
        });
    }

    static requestDeleteItem(itemId) {
        console.log(`${TeamBox.ID} | Socket | Sending delete item request:`, itemId);
        game.socket.emit(`module.${TeamBox.ID}`, {
            type: 'requestDeleteItem',
            data: { itemId }
        });
    }

    static _handleItemAdded(data) {
        console.log(`${TeamBox.ID} | Socket | Handling item added:`, data);
        
        // Mettre à jour l'interface uniquement
        if (game.teamBox?.inventory) {
            const inventory = game.settings.get(TeamBox.ID, TeamBox.FLAGS.INVENTORY) || [];
            const updatedInventory = [...inventory]; // Créer une copie pour forcer le rafraîchissement
            
            // Ajouter le nouvel item à l'inventaire local si ce n'est pas déjà fait
            const existingItem = updatedInventory.find(i => i.uuid === data.item.uuid);
            if (!existingItem) {
                updatedInventory.push({
                    ...data.item,
                    quantity: 1,
                    uuid: data.item.uuid || randomID()
                });
            }
            
            // Mettre à jour l'affichage
            game.teamBox.inventory.updateDisplay(updatedInventory);
        }
    }

    static _handleAddItemRequest(data) {
        console.log(`${TeamBox.ID} | Socket | Processing add item request:`, data);
        
        // Ajouter l'item
        TeamBox.addItem(data.item);
        
        // Notifier tous les clients
        this.notifyItemAdded(data.item);
    }

    static requestAddItem(item) {
        console.log(`${TeamBox.ID} | Socket | Requesting add item:`, item);
        
        if (game.user.isGM) {
            // Le MJ peut ajouter directement
            TeamBox.addItem(item);
            this.notifyItemAdded(item);
        } else {
            // Les joueurs envoient une demande au MJ
            game.socket.emit(`module.${TeamBox.ID}`, {
                type: 'requestAddItem',
                data: { item }
            });
        }
    }

    static notifyItemAdded(item) {
        console.log(`${TeamBox.ID} | Socket | Notifying item added:`, item);
        
        game.socket.emit(`module.${TeamBox.ID}`, {
            type: 'itemAdded',
            data: { 
                item: {
                    ...item,
                    uuid: item.uuid || randomID()
                }
            }
        });
    }

    static async _handleTakeItem(itemId) {
        const inventory = game.settings.get(TeamBox.ID, TeamBox.FLAGS.INVENTORY) || [];
        const item = inventory.find(i => i.uuid === itemId);
        
        if (!item) return;

        // Créer une copie pour le joueur
        const playerItem = duplicate(item);
        playerItem.uuid = randomID();
        playerItem.owner = game.user.name;
        playerItem.quantity = 1;

        // Mettre à jour ou supprimer l'item original
        if (item.quantity > 1) {
            await TeamBox.updateItem(itemId, { quantity: item.quantity - 1 });
        } else {
            await TeamBox.removeItem(itemId);
        }

        // Ajouter le nouvel item
        await TeamBox.addItem(playerItem);
        ui.notifications.info(game.i18n.format('TEAMBOX.Notifications.ItemTaken', { name: item.name }));
    }
}

Hooks.once('ready', () => {
    TeamBoxSocket.initialize();
});

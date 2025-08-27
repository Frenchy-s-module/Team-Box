import { TeamBoxApp } from './ui/inventory-app.js';
import { TeamBoxThemeManager } from './themes/theme-manager.js';
import { TeamBoxSocket } from './socket.js';

export class TeamBox {
    static ID = 'team-box';
    
    static FLAGS = {
        INVENTORY: 'inventory'
    };

    static initialize() {
        console.log(`${this.ID} | Initializing module`);
        this.registerSettings();
        this.hookButtons();
        console.log(`${this.ID} | Module initialization complete`);
    }

    static registerSettings() {
        console.log(`${this.ID} | Registering settings`);
        
        // Enregistrement de l'inventaire
        game.settings.register(this.ID, this.FLAGS.INVENTORY, {
            name: 'Team Inventory',
            scope: 'world',
            config: false,
            type: Object,
            default: []
        });
        
        console.log(`${this.ID} | Settings registered`);
    }

    static hookButtons() {
        console.log(`${this.ID} | Setting up button hooks`);
        Hooks.on('getSceneControlButtons', (controls) => {
            try {
                console.log(`${this.ID} | getSceneControlButtons hook fired`, controls);
                console.log(`${this.ID} | controls typeof:`, typeof controls);
                if (!controls) {
                    console.warn(`${this.ID} | controls is falsy`);
                    return;
                }

                let list = [];
                if (Array.isArray(controls)) {
                    list = controls;
                    console.log(`${this.ID} | controls detected as Array, length:`, list.length);
                } else if (Array.isArray(controls.controls)) {
                    list = controls.controls;
                    console.log(`${this.ID} | controls.controls detected as Array, length:`, list.length);
                } else if (typeof controls === 'object') {
                    list = Object.values(controls).filter(v => v && typeof v === 'object' && (Array.isArray(v.tools) || typeof v.name === 'string'));
                    console.log(`${this.ID} | controls detected as Object, derived list length:`, list.length);
                }

                if (!Array.isArray(list) || list.length === 0) {
                    console.warn(`${this.ID} | No controls list could be derived.`);
                    return;
                }

                console.log(`${this.ID} | Available control group names:`, list.map(c => c?.name));

                let tokenButton = list.find(c => c?.name === 'token') || list.find(c => c?.name === 'tokens');
                if (!tokenButton) {
                    // Tentative par layer
                    tokenButton = list.find(c => c?.layer?.toLowerCase?.().includes('token'));
                }
                console.log(`${this.ID} | Selected token control group:`, tokenButton);
            
            if (tokenButton) {
                if (Array.isArray(tokenButton.tools)) {
                    // Éviter les doublons
                    if (tokenButton.tools.some(t => t?.name === 'team-inventory')) return;
                    const toolDef = {
                        name: 'team-inventory',
                        title: game.i18n.localize('TEAMBOX.Title'),
                        icon: 'fas fa-box-open',
                        button: true,
                        toggle: false,
                        active: false,
                        visible: true,
                        onClick: () => {
                            console.log(`${this.ID} | Inventory button clicked (array tools)`);
                            TeamBoxApp.show();
                        }
                    };
                    console.log(`${this.ID} | Pushing tool to tokenButton.tools (array)`, toolDef);
                    tokenButton.tools.push(toolDef);
                    console.log(`${this.ID} | Added inventory button to token controls (array). tools length now:`, tokenButton.tools.length);
                } else if (tokenButton.tools && typeof tokenButton.tools === 'object') {
                    // v13: tools est un objet clé -> définition
                    const toolKey = 'team-inventory';
                    tokenButton.tools[toolKey] = {
                        name: toolKey,
                        title: game.i18n.localize('TEAMBOX.Title'),
                        icon: 'fas fa-box-open',
                        button: true,
                        toggle: false,
                        active: false,
                        visible: true,
                        onClick: () => {
                            console.log(`${this.ID} | Inventory button clicked (object tools)`);
                            TeamBoxApp.show();
                        }
                    };
                    console.log(`${this.ID} | Added inventory tool to tokenButton.tools (object). Keys now:`, Object.keys(tokenButton.tools));
                }
            } else {
                console.warn(`${this.ID} | Could not find token button in controls`);
                console.warn(`${this.ID} | Debug controls snapshot:`, JSON.stringify(list.map(c => ({ name: c?.name, layer: c?.layer, toolCount: Array.isArray(c?.tools) ? c.tools.length : 0 })), null, 2));
            }
            } catch (e) {
                console.error(`${this.ID} | Error in getSceneControlButtons handler:`, e);
            }
        });
        console.log(`${this.ID} | Button hooks setup complete`);
    }

    static async addItem(item) {
        console.log(`${TeamBox.ID} | Adding item:`, item);
        try {
            const inventory = game.settings.get(this.ID, this.FLAGS.INVENTORY) || [];
            
            // Vérifier si l'item existe déjà
            const existingItem = inventory.find(i => i.uuid === item.uuid);
            if (existingItem) {
                existingItem.quantity = (existingItem.quantity || 1) + 1;
                await game.settings.set(this.ID, this.FLAGS.INVENTORY, inventory);
            } else {
                // Ajouter le nouvel item
                const newItem = {
                    ...item,
                    quantity: 1,
                    uuid: item.uuid || foundry.utils.randomID()
                };
                inventory.push(newItem);
                await game.settings.set(this.ID, this.FLAGS.INVENTORY, inventory);
            }

            // Rafraîchir l'interface si elle est ouverte
            if (game.teamBox?.inventory) {
                game.teamBox.inventory.render(true);
            }

            return true;
        } catch (error) {
            console.error(`${TeamBox.ID} | Error adding item:`, error);
            return false;
        }
    }

    static async removeItem(itemId) {
        console.log(`${TeamBox.ID} | Removing item:`, itemId);
        try {
            const inventory = game.settings.get(this.ID, this.FLAGS.INVENTORY) || [];
            const itemIndex = inventory.findIndex(i => i.uuid === itemId);
            
            if (itemIndex === -1) {
                console.warn(`${TeamBox.ID} | Item not found:`, itemId);
                return false;
            }
            
            // Supprimer l'item
            inventory.splice(itemIndex, 1);
            await game.settings.set(this.ID, this.FLAGS.INVENTORY, inventory);
            
            // Notifier tous les clients
            if (game.socket) {
                game.socket.emit(`module.${this.ID}`, {
                    type: 'itemRemoved',
                    data: { itemId }
                });
            }
            
            // Rafraîchir l'interface si elle est ouverte
            if (game.teamBox?.inventory) {
                game.teamBox.inventory.render(true);
            }
            
            return true;
        } catch (error) {
            console.error(`${TeamBox.ID} | Error removing item:`, error);
            return false;
        }
    }

    static async updateItem(itemId, updates) {
        console.log(`${TeamBox.ID} | Updating item:`, { itemId, updates });
        
        try {
            const inventory = game.settings.get(this.ID, this.FLAGS.INVENTORY) || [];
            const item = inventory.find(i => i.uuid === itemId);
            
            if (!item) {
                console.warn(`${TeamBox.ID} | Item not found:`, itemId);
                return false;
            }

            // Appliquer les mises à jour
            Object.assign(item, updates);
            
            // Sauvegarder l'inventaire
            await game.settings.set(this.ID, this.FLAGS.INVENTORY, inventory);
            
            // Notifier tous les clients de la mise à jour
            if (game.socket) {
                game.socket.emit(`module.${this.ID}`, {
                    type: 'updateQuantity',
                    data: { itemId, quantity: updates.quantity }
                });
            }
            
            // Rafraîchir l'interface si elle est ouverte
            if (game.teamBox?.inventory) {
                game.teamBox.inventory.render(true);
            }
            
            return true;
        } catch (error) {
            console.error(`${TeamBox.ID} | Error updating item:`, error);
            return false;
        }
    }

    static init() {
        console.log(`${this.ID} | Initializing module`);

        // Register custom Handlebars helpers
        Handlebars.registerHelper('lowercase', function(str) {
            return str.toLowerCase();
        });

        Handlebars.registerHelper('capitalize', function(str) {
            return str.charAt(0).toUpperCase() + str.slice(1);
        });

        Handlebars.registerHelper('concat', function(str1, str2) {
            return str1 + str2;
        });

        // Register module settings
        this.registerSettings();
        this.hookButtons();
        console.log(`${this.ID} | Module initialization complete`);
    }
}

// Make TeamBox available globally for compatibility
globalThis.TeamBox = TeamBox;

// Hook into Foundry's init
Hooks.once('init', () => {
    console.log('===========================================');
    console.log(`${TeamBox.ID} | Beginning initialization`);
    console.log('===========================================');
    TeamBox.init();
});

// Hook into Foundry's ready
Hooks.once('ready', async () => {
    console.log('===========================================');
    console.log(`${TeamBox.ID} | Ready hook fired`);
    console.log('===========================================');
    
    // Initialiser le gestionnaire de thèmes
    TeamBoxThemeManager.init();

    // Initialiser les sockets une seule fois
    TeamBoxSocket.initialize();

    console.log(`${TeamBox.ID} | Module ready`);
});

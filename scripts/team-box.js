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
        TeamBoxSocket.initialize();
        console.log(`${this.ID} | Module initialization complete`);
    }

    static registerSettings() {
        console.log(`${this.ID} | Registering settings`);
        
        // Enregistrement du thème
        game.settings.register(this.ID, 'theme', {
            name: 'TEAMBOX.Settings.Theme.Name',
            hint: 'TEAMBOX.Settings.Theme.Hint',
            scope: 'client',
            config: true,
            type: String,
            choices: {
                'default': 'Default',
                'alienrpg': 'Alien RPG'
            },
            default: 'default',
            onChange: value => TeamBoxThemeManager.applyTheme(value)
        });

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
            console.log(`${this.ID} | getSceneControlButtons hook fired`, controls);
            const tokenButton = controls.find(c => c.name === "token");
            console.log(`${this.ID} | Found token button:`, tokenButton);
            
            if (tokenButton) {
                tokenButton.tools.push({
                    name: "team-inventory",
                    title: game.i18n.localize("TEAMBOX.Title"),
                    icon: "fas fa-box-open",
                    button: true,
                    visible: true,
                    onClick: () => {
                        console.log(`${this.ID} | Inventory button clicked`);
                        TeamBoxApp.show();
                    }
                });
                console.log(`${this.ID} | Added inventory button to token controls`);
            } else {
                console.warn(`${this.ID} | Could not find token button in controls`);
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
                    uuid: item.uuid || randomID()
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
        TeamBoxSocket.initialize();
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

    // Initialiser les sockets si on est le MJ
    if (game.user.isGM) {
        TeamBoxSocket.initialize();
    }

    console.log(`${TeamBox.ID} | Module ready`);
});

import { TeamBox } from '../team-box.js';
import { GAME_THEMES } from './game-themes.js';

export class TeamBoxThemeManager {
    static init() {
        console.log(`${TeamBox.ID} | Theme Manager | Available themes:`, GAME_THEMES);
        
        // Créer les choix de thèmes à partir de GAME_THEMES
        const themes = Object.keys(GAME_THEMES).reduce((acc, key) => {
            acc[key] = GAME_THEMES[key].name || key;
            return acc;
        }, {});
        
        console.log(`${TeamBox.ID} | Theme Manager | Registered theme choices:`, themes);

        game.settings.register('team-box', 'theme', {
            name: 'TEAMBOX.Settings.Theme.Name',
            hint: 'TEAMBOX.Settings.Theme.Hint',
            scope: 'client',
            config: true,
            type: String,
            choices: themes,
            default: 'default',
            onChange: value => {
                // Appliquer le thème seulement si la fenêtre est ouverte
                if (game.teamBox?.inventory) {
                    this.applyTheme(value);
                }
            }
        });
    }

    static applyTheme(themeName) {
        console.log(`${TeamBox.ID} | Theme Manager | Applying theme:`, themeName);
        const app = document.getElementById('team-box-inventory');
        if (!app) {
            console.warn(`${TeamBox.ID} | Theme Manager | No app element found`);
            return;
        }
        
        const theme = GAME_THEMES[themeName] || GAME_THEMES.default;
        console.log(`${TeamBox.ID} | Theme Manager | Theme data:`, theme);
        
        // Appliquer les variables CSS
        const cssVariables = {
            '--primary-color': theme.primaryColor,
            '--accent-color': theme.accentColor,
            '--background-color': theme.backgroundColor,
            '--border-color': theme.borderColor,
            '--text-color': theme.textColor,
            '--font-primary': theme.fontPrimary,
            '--box-shadow': theme.boxShadow
        };

        console.log(`${TeamBox.ID} | Theme Manager | Applying CSS variables:`, cssVariables);
        
        Object.entries(cssVariables).forEach(([key, value]) => {
            app.style.setProperty(key, value);
            console.log(`${TeamBox.ID} | Theme Manager | Set ${key} to ${value}`);
        });
        
        // Convertir la couleur primaire en RGB pour les effets de transparence
        const rgb = this._hexToRgb(theme.primaryColor);
        if (rgb) {
            const rgbValue = `${rgb.r}, ${rgb.g}, ${rgb.b}`;
            app.style.setProperty('--primary-color-rgb', rgbValue);
            console.log(`${TeamBox.ID} | Theme Manager | Set --primary-color-rgb to ${rgbValue}`);
        }
        
        // Vérifier les styles appliqués
        const computedStyle = window.getComputedStyle(app);
        console.log(`${TeamBox.ID} | Theme Manager | Computed styles:`, {
            primaryColor: computedStyle.getPropertyValue('--primary-color'),
            backgroundColor: computedStyle.getPropertyValue('--background-color'),
            textColor: computedStyle.getPropertyValue('--text-color')
        });
    }

    static _hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        if (!result) {
            console.warn(`${TeamBox.ID} | Theme Manager | Invalid hex color:`, hex);
            return null;
        }
        return {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        };
    }
}

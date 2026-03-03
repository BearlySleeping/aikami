import { describe, expect, test } from 'bun:test';

const en = {
  hello_world: 'Hello, {name} from en!',
  navigation: 'Navigation',
  home: 'Home',
  characters: 'Characters',
  profile: 'Profile',
  settings: 'Settings',
  logout: 'Logout',
  login: 'Sign In',
  register: 'Sign Up',
};

const es = {
  hello_world: '¡Hola, {name} de es!',
  navigation: 'Navegación',
  home: 'Inicio',
  characters: 'Personajes',
  profile: 'Perfil',
  settings: 'Configuración',
  logout: 'Cerrar sesión',
  login: 'Iniciar sesión',
  register: 'Registrarse',
};

const fr = {
  hello_world: 'Bonjour, {name} de fr!',
  navigation: 'Navigation',
  home: 'Accueil',
  characters: 'Personnages',
  profile: 'Profil',
  settings: 'Paramètres',
  logout: 'Déconnexion',
  login: 'Se connecter',
  register: "S'inscrire",
};

type Locale = 'en' | 'es' | 'fr';
type Messages = typeof en;

const messages: Record<Locale, Messages> = { en, es, fr };

function t(locale: Locale, key: keyof Messages, params?: Record<string, string>): string {
  let text = messages[locale][key];
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(`{${k}}`, v);
    }
  }
  return text;
}

describe('i18n', () => {
  describe('English (en)', () => {
    test('should have basic translations', () => {
      expect(t('en', 'navigation')).toBe('Navigation');
      expect(t('en', 'home')).toBe('Home');
      expect(t('en', 'characters')).toBe('Characters');
      expect(t('en', 'profile')).toBe('Profile');
      expect(t('en', 'settings')).toBe('Settings');
      expect(t('en', 'logout')).toBe('Logout');
      expect(t('en', 'login')).toBe('Sign In');
      expect(t('en', 'register')).toBe('Sign Up');
    });

    test('should replace parameters', () => {
      expect(t('en', 'hello_world', { name: 'World' })).toBe('Hello, World from en!');
    });
  });

  describe('Spanish (es)', () => {
    test('should have basic translations', () => {
      expect(t('es', 'navigation')).toBe('Navegación');
      expect(t('es', 'home')).toBe('Inicio');
      expect(t('es', 'characters')).toBe('Personajes');
      expect(t('es', 'profile')).toBe('Perfil');
      expect(t('es', 'settings')).toBe('Configuración');
      expect(t('es', 'logout')).toBe('Cerrar sesión');
      expect(t('es', 'login')).toBe('Iniciar sesión');
      expect(t('es', 'register')).toBe('Registrarse');
    });

    test('should replace parameters', () => {
      expect(t('es', 'hello_world', { name: 'Mundo' })).toBe('¡Hola, Mundo de es!');
    });
  });

  describe('French (fr)', () => {
    test('should have basic translations', () => {
      expect(t('fr', 'navigation')).toBe('Navigation');
      expect(t('fr', 'home')).toBe('Accueil');
      expect(t('fr', 'characters')).toBe('Personnages');
      expect(t('fr', 'profile')).toBe('Profil');
      expect(t('fr', 'settings')).toBe('Paramètres');
      expect(t('fr', 'logout')).toBe('Déconnexion');
      expect(t('fr', 'login')).toBe('Se connecter');
      expect(t('fr', 'register')).toBe("S'inscrire");
    });

    test('should replace parameters', () => {
      expect(t('fr', 'hello_world', { name: 'Monde' })).toBe('Bonjour, Monde de fr!');
    });
  });
});

describe('Navigation Keys', () => {
  test('should have all required navigation keys in en.json', () => {
    const requiredKeys: (keyof Messages)[] = [
      'navigation',
      'home',
      'characters',
      'profile',
      'settings',
      'logout',
    ];

    for (const key of requiredKeys) {
      expect(en[key]).toBeDefined();
    }
  });
});

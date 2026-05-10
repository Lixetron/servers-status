import { LANG_KEY, readStoredLangChoice, readStoredPollChoice, type UiLang } from './config';

type MessagePack = Record<string, string>;

/** Загружается из JSON; до вызова {@link loadI18nMessages} объект пустой. */
let I18N: Record<UiLang, MessagePack> = {
    en: {},
    ru: {},
};

let currentLang: UiLang = 'en';

/**
 * Подтягивает переводы рядом с бандлом: `public/js/locales/*.json` (import.meta.url у `min.js`).
 * Вызывать один раз до {@link initLang} и любых обращений к {@link t}.
 */
export async function loadI18nMessages(): Promise<void> {
    const enUrl = new URL('./locales/en.json', import.meta.url);
    const ruUrl = new URL('./locales/ru.json', import.meta.url);
    const [enRes, ruRes] = await Promise.all([fetch(enUrl), fetch(ruUrl)]);

    if (!enRes.ok) {
        throw new Error(`Failed to load ${enUrl}`);
    }

    if (!ruRes.ok) {
        throw new Error(`Failed to load ${ruUrl}`);
    }

    I18N = {
        en: (await enRes.json()) as MessagePack,
        ru: (await ruRes.json()) as MessagePack,
    };
}

export function getLang(): UiLang {
    return currentLang;
}

export function t(key: string): string {
    const pack = I18N[currentLang] || I18N.en;

    return (pack[key] !== undefined
        ? pack[key]
        : I18N.en[key]) || key;
}

function browserLang(): UiLang {
    let list: readonly string[] = [];

    if (typeof navigator.languages !== 'undefined' && navigator.languages.length) {
        list = navigator.languages;
    } else if (navigator.language) {
        list = [navigator.language];
    }

    for (let i = 0; i < list.length; i++) {
        const tag = String(list[i] || '').toLowerCase();

        if (tag.indexOf('ru') === 0) {
            return 'ru';
        }
    }

    return 'en';
}

function detectLang(): UiLang {
    return readStoredLangChoice() || browserLang();
}

function applyStaticI18n(): void {
    document.documentElement.lang = currentLang === 'ru'
        ? 'ru'
        : 'en';
    document.title = t('pageTitle');

    const metaDesc = document.querySelector('meta[name="description"]');

    if (metaDesc) {
        metaDesc.setAttribute('content', t('metaDescription'));
    }

    document.querySelectorAll('[data-i18n]')
        .forEach((el) => {
            const key = el.getAttribute('data-i18n');

            if (key) {
                el.textContent = t(key);
            }
        });

    const sel = document.getElementById('lang-select');

    if (sel && sel instanceof HTMLSelectElement) {
        sel.value = currentLang;
        sel.setAttribute('aria-label', t('language'));
    }

    const pollSel = document.getElementById('poll-select');

    if (pollSel && pollSel instanceof HTMLSelectElement) {
        pollSel.value = readStoredPollChoice();
        pollSel.setAttribute('aria-label', t('pollInterval'));
    }
}

/** После {@link loadI18nMessages}: язык из localStorage или браузера. */
export function initLang(): void {
    currentLang = detectLang();

    applyStaticI18n();
}

/** Смена языка пользователем: сохранение и обновление подписей. */
export function setLang(lang: UiLang): void {
    if (lang !== 'en' && lang !== 'ru') {
        return;
    }

    currentLang = lang;

    try {
        localStorage.setItem(LANG_KEY, lang);
    } catch {
        /* ignore */
    }

    applyStaticI18n();
}

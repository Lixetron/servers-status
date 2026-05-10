import {LANG_KEY, readStoredLangChoice, readStoredPollChoice} from './config.js';

/** Загружается из JSON; до вызова {@link loadI18nMessages} объект пустой. */
let I18N = {
    en: {},
    ru: {},
};

let currentLang = 'en';

/**
 * Подтягивает переводы рядом с этим модулем: `./locales/en.json`, `./locales/ru.json`.
 * Вызывать один раз до {@link initLang} и любых обращений к {@link t}.
 */
export async function loadI18nMessages() {
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
        en: await enRes.json(),
        ru: await ruRes.json(),
    };
}

export function getLang() {
    return currentLang;
}

export function t(key) {
    const pack = I18N[currentLang] || I18N.en;

    return (pack[key] !== undefined
        ? pack[key]
        : I18N.en[key]) || key;
}

function browserLang() {
    let list = [];

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

function detectLang() {
    return readStoredLangChoice() || browserLang();
}

function applyStaticI18n() {
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

    if (sel) {
        sel.value = currentLang;
        sel.setAttribute('aria-label', t('language'));
    }

    const pollSel = document.getElementById('poll-select');

    if (pollSel) {
        pollSel.value = readStoredPollChoice();
        pollSel.setAttribute('aria-label', t('pollInterval'));
    }
}

/** После {@link loadI18nMessages}: язык из localStorage или браузера. */
export function initLang() {
    currentLang = detectLang();

    applyStaticI18n();
}

/** Смена языка пользователем: сохранение и обновление подписей. */
export function setLang(lang) {
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

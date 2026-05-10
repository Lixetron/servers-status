import { loadAll } from './app';
import { initLang, loadI18nMessages, setLang } from './i18n';
import { setPollIntervalChoice, startLivePolling, updateLiveLabel } from './polling';

async function bootstrap(): Promise<void> {
    await loadI18nMessages();

    initLang();

    startLivePolling(loadAll);

    const langSelect = document.getElementById('lang-select');

    if (langSelect && langSelect instanceof HTMLSelectElement) {
        langSelect.addEventListener('change', (e) => {
            const target = e.target;

            if (target instanceof HTMLSelectElement) {
                setLang(target.value as 'en' | 'ru');
                updateLiveLabel();

                void loadAll();
            }
        });
    }

    const pollSelect = document.getElementById('poll-select');

    if (pollSelect && pollSelect instanceof HTMLSelectElement) {
        pollSelect.addEventListener('change', (e) => {
            const target = e.target;

            if (target instanceof HTMLSelectElement) {
                setPollIntervalChoice(target.value);

                void loadAll();
            }
        });
    }

    void loadAll();
}

void bootstrap();

import {initLang, loadI18nMessages, setLang} from './i18n.js';
import {loadAll} from './app.js';
import {
    setPollIntervalChoice,
    startLivePolling,
    updateLiveLabel,
} from './polling.js';

async function bootstrap() {
    await loadI18nMessages();

    initLang();

    startLivePolling(loadAll);

    document.getElementById('lang-select')
        .addEventListener('change', (e) => {
            setLang(e.target.value);
            updateLiveLabel();

            void loadAll();
        });

    document.getElementById('poll-select')
        .addEventListener('change', (e) => {
            setPollIntervalChoice(e.target.value);

            void loadAll();
        });

    void loadAll();
}

void bootstrap();

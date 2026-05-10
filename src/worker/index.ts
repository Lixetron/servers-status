import { handleFetch } from './handler';
import { runScheduled, withSnapshotGate } from './snapshot';

export default {
    fetch: handleFetch,

    async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
        await withSnapshotGate(() => runScheduled(env));
    },
};

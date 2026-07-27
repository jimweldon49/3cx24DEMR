import { TableClient } from "@azure/data-tables";

const TABLE_NAME = "LeadIdByPhone";
const PARTITION_KEY = "lead";

// 4D EMR's Leads API has no lookup-by-phone or lookup-by-id (confirmed by
// exhaustive testing 2026-07-27) -- the only way to find a caller's lead again
// is to remember the id ourselves from when we created it. An in-memory Map
// loses that on every restart/redeploy, which happens often in this project,
// so this persists the mapping in Azure Table Storage instead. Falls back to
// memory-only if AZURE_STORAGE_CONNECTION_STRING isn't configured (dev/local).
export class LeadIdStore {
    tableClient;
    logger;
    memoryCache = new Map();

    constructor(config, logger) {
        this.logger = logger;
        if (config.azureStorageConnectionString) {
            this.tableClient = TableClient.fromConnectionString(config.azureStorageConnectionString, TABLE_NAME);
        }
    }

    async get(phone) {
        if (this.memoryCache.has(phone)) {
            return this.memoryCache.get(phone);
        }
        if (!this.tableClient) {
            return undefined;
        }
        try {
            const entity = await this.tableClient.getEntity(PARTITION_KEY, phone);
            const leadId = entity.leadId;
            this.memoryCache.set(phone, leadId);
            return leadId;
        }
        catch (error) {
            if (error.statusCode === 404) {
                return undefined;
            }
            this.logger.error({ err: error, phone }, "Failed to read lead id from table storage");
            return undefined;
        }
    }

    async set(phone, leadId) {
        this.memoryCache.set(phone, leadId);
        if (!this.tableClient) {
            return;
        }
        try {
            await this.tableClient.upsertEntity({ partitionKey: PARTITION_KEY, rowKey: phone, leadId }, "Replace");
        }
        catch (error) {
            this.logger.error({ err: error, phone, leadId }, "Failed to persist lead id to table storage");
        }
    }
}

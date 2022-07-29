export interface Package {
    name: string;
    tenant: {
        id: string;
        name: string;
    };
    workflows: {
        id: string;
        name: string;
        key: string;
    }[];
    connections: {
        id: string;
        name: string;
    }[];
    datasources: {
        id: string;
        name: string;
    }[];
    contracts: {
        id: string;
        name: string;
    }[];
}

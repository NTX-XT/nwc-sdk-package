export interface DeploymentConfiguration {
    target: {
        id: string;
        name: string;
    },
    contracts: {
        sourceName: string;
        targetName: string;
    }[],
    connections: {
        sourceName: string;
        targetName: string;
    }[],
    datasources: {
        sourceName: string;
        targetName: string;
    }[],
    workflows: {
        sourceName: string;
        targetName: string;
    }[]
}

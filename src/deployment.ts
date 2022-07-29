import { Sdk, Workflow, WorkflowHelper } from "@nwc-sdk/client";
import { readFileSync, writeFileSync } from "fs";
import { DeploymentConfiguration } from "./deploymentConfiguration";
import { Package } from "./package";

export class Deployment {
    private _target: Sdk
    private _package: Package;
    public get package(): Package {
        return this._package;
    }

    private _configuration: DeploymentConfiguration;
    public get configuration(): DeploymentConfiguration {
        return this._configuration;
    }

    public static load = (target: Sdk, path: string, configurationPath?: string): Deployment => {
        return new Deployment(
            target,
            JSON.parse(readFileSync(path, 'utf-8')),
            (configurationPath) ? JSON.parse(readFileSync(configurationPath, 'utf-8')) as DeploymentConfiguration : undefined
        )
    }

    private constructor(target: Sdk, deploymentPackage: Package, configuration?: DeploymentConfiguration) {
        this._target = target
        this._package = deploymentPackage
        this._configuration = (configuration) || this.newDeploymentConfiguration()
    }

    private newDeploymentConfiguration = (): DeploymentConfiguration => (
        {
            target: {
                id: this._target.tenant.id,
                name: this._target.tenant.name
            },
            connections: [],
            contracts: [],
            datasources: [],
            workflows: []
        }
    )

    private processDatasources = async (workflow: Workflow): Promise<boolean> => {
        let resolved: boolean = true
        for (const dep of WorkflowHelper.allDatasourceDependencies(workflow.dependencies)) {
            const existingDatasource = await this._target.tryGetDatasource(dep.datasourceId)
            if (existingDatasource) continue;
            const sourceDatasource = this._package.datasources.find(ds => ds.id === dep.datasourceId)
            if (sourceDatasource) {
                const targetDatasourceName = this._configuration.datasources.find(ds => ds.sourceName === dep.name)?.targetName ?? this._package.datasources.find(ds => ds.name === dep.name)!.name
                const targetDatasource = await this._target.getDatasourceByName(targetDatasourceName)
                const targetConnection = await this._target.getConnection(targetDatasource!.connectionId)
                WorkflowHelper.swapDatasource(workflow, sourceDatasource!.id, targetDatasource!, targetConnection!)
                // writeFileSync(`./imported_${workflow.name}-ds.json`, JSON.stringify(workflow))
            } else {
                resolved = false
            }
        }
        return resolved
    }

    private processConnections = async (workflow: Workflow): Promise<boolean> => {
        let resolved: boolean = true

        for (const dep of WorkflowHelper.allConnectionDependencies(workflow.dependencies)) {
            const existingConnection = await this._target.getConnection(dep.connectionId)
            if (existingConnection) continue
            const sourceConnection = this._package.connections.find(cn => cn.name === dep.connectionName)
            if (!sourceConnection && dep.connectionId === 'undefined') {
                const sourceContract = this._package.contracts.find(cn => cn.id === dep.contractId)
                if (sourceContract) {
                    const targetContractName = this._configuration.contracts.find(cn => cn.sourceName === sourceContract.name)
                    if (targetContractName) {
                        const targetContract = await this._target.getContractByName(targetContractName.targetName)
                        if (targetContract) {
                            const targetContractSchema = await this._target.getContractSchema(targetContract.id)
                            const targetConnection = (await this._target.getConnections()).find(cn => cn.contractId === targetContract.id)
                            if (targetConnection) {
                                dep.connectionName = targetConnection.name + '_resolved'
                                WorkflowHelper.swapConnection(workflow, "", targetConnection, targetConnection.name + '_resolved', targetContract, targetContractSchema)
                            }
                        }
                    }
                }
            } else if (sourceConnection) {
                const targetConnectionName = this._configuration.connections.find(cn => cn.sourceName === dep.connectionName)?.targetName ?? this._package.connections.find(cn => cn.name === dep.connectionName)!.name
                const targetConnection = await this._target.getConnectionByName(targetConnectionName)
                const targetContract = await this._target.getContract(targetConnection!.contractId)
                const targetContractSchema = await this._target.getContractSchema(targetConnection!.contractId)
                WorkflowHelper.swapConnection(workflow, sourceConnection!.id, targetConnection!, sourceConnection!.name, targetContract!, targetContractSchema!)
            } else {
                resolved = false
            }
        }
        return resolved
    }

    private processWorkflows = async (workflow: Workflow): Promise<boolean> => {
        let resolved: boolean = true

        for (const dep of WorkflowHelper.allWorkflowDependencies(workflow.dependencies)) {
            const existingWorkflow = await this._target.tryGetWorkflow(dep.workflowId)
            if (existingWorkflow) continue

            const sourceWorkflow = this._package.workflows.find(w => w.id === dep.workflowId)
            if (sourceWorkflow) {
                const targetWorkflowName = this._configuration.workflows.find(w => w.sourceName === sourceWorkflow!.name)?.targetName ?? sourceWorkflow!.name
                const targetWorkflow = await this._target.getWorkflowByName(targetWorkflowName)
                WorkflowHelper.swapWorkflowDependency(workflow, dep.workflowId, targetWorkflow!.id)
            } else {
                resolved = false
            }
        }
        return resolved
    }

    public deploySingleWorkflow = async (workflow: { id: string, name: string, key: string }, publish: boolean = true, overwriteExisting: boolean = false): Promise<boolean> => {
        let shouldPublish: boolean = publish
        const targetWorkflowName = this._configuration.workflows?.find(w => w.sourceName === workflow.name)?.targetName ?? workflow.name
        const imported = await this._target.importWorkflow(targetWorkflowName, workflow.key, overwriteExisting)
        // writeFileSync(`./imported_${imported.name}.json`, JSON.stringify(imported))

        const connectionsResolved = await this.processConnections(imported)
        const datasourcesResolved = await this.processDatasources(imported)
        const workflowsResolved = await this.processWorkflows(imported)

        if (shouldPublish) {
            shouldPublish = datasourcesResolved && connectionsResolved && workflowsResolved
        }

        const updated = shouldPublish ? await this._target.publishWorkflow(imported) : await this._target.saveWorkflow(imported)
        // writeFileSync(`./${shouldPublish ? "published" : "saved"}_${updated.name}.json`, JSON.stringify(updated))
        return shouldPublish
    }

    public deploy = async (overwriteExisting: boolean = false) => {
        let canPublish: boolean = true
        for (const workflow of this._package.workflows) {
            canPublish = await this.deploySingleWorkflow(workflow, canPublish, overwriteExisting)
        }
    }
}

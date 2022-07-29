import { Sdk, Workflow, WorkflowHelper } from '@nwc-sdk/client';
import { writeFileSync, readFileSync } from 'fs';
import validator from 'validator';
import { Package } from './package';
import { WorfklowReference } from './worfklowReference';


export class Packager {
    private _source: Sdk;
    private _package: Package;
    private _processedWorkflows: Workflow[];

    public static create = (source: Sdk, packageName: string): Packager => {
        return new Packager(source, packageName);
    }

    public static load = (source: Sdk, path: string): Packager => {
        return new Packager(source, JSON.parse(readFileSync(path, 'utf-8')) as Package);
    }

    private constructor(source: Sdk, name: string)
    private constructor(source: Sdk, path: Package)
    private constructor(source: Sdk, param: string | Package) {
        this._source = source;
        this._processedWorkflows = [];
        if (typeof (param) === 'string' || param instanceof String) {
            this._package = this.createNewPackage(param.toString());
        } else {
            this._package = param
        }
    }

    private createNewPackage = (name: string): Package => ({
        name: name,
        tenant: {
            id: this._source.tenant.id,
            name: this._source.tenant.name
        },
        workflows: [],
        connections: [],
        contracts: [],
        datasources: []
    })

    public addByTag = async (tag: string) => {
        for (const design of (await this._source.getWorkflowDesigns({ tag: tag }))) {
            await this.add(design.id, false);
        }
        this.resolveWorkflowDeploymentOrder();
    };

    public async add(workflow: Workflow, processWorkfowDependencies?: boolean): Promise<void>;
    public async add(idOrName: string, processWorkfowDependencies?: boolean): Promise<void>;
    public async add(param: any, processWorkfowDependencies: boolean = true): Promise<void> {
        const workflow = (typeof (param) === "string" || param instanceof String) ?
            validator.isUUID(param.toString())
                ? await this._source.getWorkflow(param.toString())
                : await this._source.getWorkflowByName(param.toString())
            : param as Workflow;

        if (workflow && !this._processedWorkflows.find(wfl => wfl.id === workflow.id)) {
            // writeFileSync(`./source_${workflow.name}`, JSON.stringify(workflow))
            for (const connectionDependency of WorkflowHelper.allConnectionDependencies(workflow.dependencies)) {
                if (!(this._package.connections.find(cn => cn.id === connectionDependency.connectionId))) {
                    this._package.connections.push({
                        id: connectionDependency.connectionId,
                        name: connectionDependency.connectionName
                    });
                }
                if (!(this._package.contracts.find(cn => cn.id === connectionDependency.contractId))) {
                    const contract = (await this._source.getContract(connectionDependency.contractId))!;
                    this._package.contracts.push({
                        id: contract.id,
                        name: contract.name
                    });
                }
            }

            for (const datasourceDependency of WorkflowHelper.allDatasourceDependencies(workflow.dependencies)) {
                if (!(this._package.datasources.find(ds => ds.id === datasourceDependency.datasourceId))) {
                    this._package.datasources.push({
                        id: datasourceDependency.datasourceId,
                        name: (datasourceDependency.name) ? datasourceDependency.name : (await this._source.getDatasource(datasourceDependency.datasourceId)).name
                    });
                }
            }

            this._processedWorkflows.push(workflow);
            this._package.workflows.push({
                id: workflow.id,
                name: workflow.name,
                key: await this._source.exportWorkflow(workflow.id, true)
            });
            for (const workflowDependency of WorkflowHelper.allWorkflowDependencies(workflow.dependencies)) {
                if (!(this._package.workflows.find(wfl => wfl.id === workflowDependency.workflowId)) &&
                    (!this._processedWorkflows.find(wfl => wfl.id === workflowDependency.workflowId))) {
                    await this.add(workflowDependency.workflowId, processWorkfowDependencies);
                }
            }

            if (processWorkfowDependencies) {
                this.resolveWorkflowDeploymentOrder();
            }
        }
    }

    public savePackage = (path: string) => {
        writeFileSync(path, JSON.stringify(this._package))
    }

    private gatherDependencies(): WorfklowReference[] {
        const dependencies: WorfklowReference[] = [];
        for (const wfl of this._processedWorkflows) {
            const allWorkflowDependencies = WorkflowHelper.allWorkflowDependencies(wfl.dependencies);
            const workflowDependencies: WorfklowReference[] = allWorkflowDependencies.length === 0
                ? [{ id: wfl.id, referencedWorkflowId: undefined }]
                : allWorkflowDependencies.map<WorfklowReference>(dep => ({
                    id: wfl.id,
                    referencedWorkflowId: dep.workflowId
                }));
            for (const dependency of workflowDependencies) {
                if (!dependencies.includes(dependency)) {
                    dependencies.push(dependency);
                }
            }
        }

        return dependencies;
    }

    private processDependencies(dependencies: WorfklowReference[], workflowId: string, sorted: string[]) {
        if (sorted.includes(workflowId)) {
            return;
        }
        dependencies.filter(d => d.id === workflowId).forEach(workflowDependency => {
            if (!workflowDependency.referencedWorkflowId) {
                sorted.unshift(workflowId);
                return;
            }
            const found = dependencies.find(d => {
                return d.id === workflowDependency.referencedWorkflowId;
            });
            if (found) {
                this.processDependencies(dependencies, workflowDependency.referencedWorkflowId, sorted);
            } else {
                if (!sorted.includes(workflowDependency.referencedWorkflowId)) {
                    sorted.push(workflowDependency.referencedWorkflowId);
                }
            }
        });

        if (!sorted.includes(workflowId)) {
            sorted.push(workflowId);
        }
    }

    private resolveWorkflowDeploymentOrder() {
        const sorted = [] as string[];
        const dependencies = this.gatherDependencies();
        dependencies.forEach(dependency => {
            this.processDependencies(dependencies, dependency.id, sorted);
        });
        const sortedWorkflows = sorted.map(wId => ({
            id: wId,
            name: this._processedWorkflows.find(w => w.id === wId)!.name,
            key: this._package.workflows.find(w => w.id === wId)!.key
        }));
        this._package.workflows = sortedWorkflows;
    }
}

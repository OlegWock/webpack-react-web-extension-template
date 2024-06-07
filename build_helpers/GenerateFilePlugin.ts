import { Compilation, Compiler, sources, WebpackError } from 'webpack';

interface GenerateFilePluginOptions {
    generate: (getFilesForEntrypoint: (entrypoint: string) => string[]) => Promise<string> | string;
    outPath: string;
}

export class GenerateFilePlugin {
    private readonly generate: GenerateFilePluginOptions["generate"];
    private readonly outPath: GenerateFilePluginOptions["outPath"];

    constructor(options: GenerateFilePluginOptions) {
        if (typeof options.generate !== 'function') {
            throw new Error('generate must be a function');
        }
        if (typeof options.outPath !== 'string') {
            throw new Error('outPath must be a string');
        }

        this.generate = options.generate;
        this.outPath = options.outPath;
    }

    public apply(compiler: Compiler): void {
        compiler.hooks.thisCompilation.tap('GenerateFilePlugin', (compilation) => {
            compilation.hooks.processAssets.tapPromise(
                {
                    name: 'GenerateFilePlugin',
                    stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
                },
                async () => {
                    try {
                        const content = await this.generate((entrypointName: string) => {
                            const entrypoint = compilation.entrypoints.get(entrypointName);

                            if (!entrypoint) {
                                throw new Error(`unknown entrypoint: ${entrypointName}. Available entrypoints: ${[...compilation.entrypoints.keys()].join(', ')}`);
                            }

                            return [...entrypoint.getFiles()];
                        });

                        compilation.emitAsset(this.outPath, new sources.RawSource(content));
                    } catch (error) {
                        compilation.errors.push(new WebpackError(`GenerateFilePlugin: ${error.message}`));
                    }
                }
            );
        });
    }
}
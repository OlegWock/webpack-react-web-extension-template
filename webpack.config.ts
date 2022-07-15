import * as path from 'path';
import * as fs from 'fs';
import * as webpack from 'webpack';
import * as TerserPlugin from 'terser-webpack-plugin';
import * as GenerateFiles from 'generate-file-webpack-plugin';
import * as CopyPlugin from "copy-webpack-plugin";
import { CleanWebpackPlugin } from 'clean-webpack-plugin';
import * as FileManagerPlugin from 'filemanager-webpack-plugin';
import {
    Chunk, createPathsObject, isScript, joinPath, scriptName,
    shouldNotBeInCommonChunk, pathRelatedToExtRoot, generatePageContentForScript, generateBackgroundWorkerWrapper
} from './build_helpers/webpack-utils';

import { version, name, description } from './package.json';

/* eslint-disable @typescript-eslint/no-unused-vars */

interface WebpackEnvs {
    WEBPACK_WATCH: boolean,
    mode?: 'development' | 'production',
    targetBrowser?: 'chrome',
}

const generateManifest = (mode: Exclude<WebpackEnvs["mode"], undefined>, targetBrowser: Exclude<WebpackEnvs["targetBrowser"], undefined>) => {
    return {
        "name": name,
        "description": description,
        "version": version,
        "manifest_version": 3,
        "background": {
            "service_worker": "background-wrapper.js"
        }
    };
};


const baseSrc = './src';
const baseDist = './dist';

const config = async (env: WebpackEnvs): Promise<webpack.Configuration> => {
    const commonChunks: { [name: string]: Chunk } = {
        ui: {
            test: (module, context) => {
                const name = module.nameForCondition();
                if (!name) return false;
                const absBase = path.resolve(__dirname);
                const relativePath = name.replace(absBase, '.').toLowerCase();
                if (shouldNotBeInCommonChunk(relativePath, entries)) return false;
                return relativePath.includes('react') || relativePath.includes('jquery');
            },
        },
        other: {
            test: (module, context) => {
                const name = module.nameForCondition();
                if (!name) return false;
                const absBase = path.resolve(__dirname);
                const relativePath = name.replace(absBase, '.').toLowerCase();
                if (shouldNotBeInCommonChunk(relativePath, entries)) return false;
                return !relativePath.includes('react') && !relativePath.includes('jquery');
            },
        },
    } as const;

    const { mode = 'development', targetBrowser = 'chrome', WEBPACK_WATCH } = env;

    const paths = createPathsObject(baseSrc, joinPath(baseDist, targetBrowser));

    const pageTemplate = fs.readFileSync(paths.src.pageHtmlTemplate, {
        encoding: 'utf-8'
    });

    const entries = {
        backgroundScript: paths.src.background,
    };
    const outputs = {
        backgroundScript: paths.dist.background,
    }

    const libsRoot = pathRelatedToExtRoot(paths, 'libs');

    const generateFileInvocations: GenerateFiles[] = [];

    const pages = fs.readdirSync(paths.src.pages).filter(isScript);
    pages.forEach(page => {
        const cleanName = scriptName(page);
        entries[cleanName] = joinPath(paths.src.pages, page);
        outputs[cleanName] = joinPath(paths.dist.pages, cleanName + '.js');

        const scriptsToInject = [
            `${cleanName}.js`,
            ...Object.keys(commonChunks).map(name => `${name}.js`)
        ];

        generateFileInvocations.push(new GenerateFiles({
            file: joinPath(paths.dist.pages, `${cleanName}.html`),
            content: generatePageContentForScript(pageTemplate, {
                scripts: scriptsToInject.map(name => {
                    return `<script src="${libsRoot}/${name}"></script>`;
                }).join('\n')
            }),
        }));
    });

    // TODO: somehow automatically inject these in generated manifest?
    const contentscripts = fs.readdirSync(paths.src.contentscripts).filter(isScript);
    contentscripts.forEach(cs => {
        const cleanName = scriptName(cs);
        entries[cleanName] = joinPath(paths.src.contentscripts, cs);
        outputs[cleanName] = joinPath(paths.dist.contentscripts, cleanName + '.js');
    });

    const cacheGroups = {};
    Object.entries(commonChunks).forEach(([name, entry]) => {
        cacheGroups[name] = {
            ...entry,
            name: name,
            priority: 10,
            filename: joinPath(paths.dist.libs, `${name}.js`),
            chunks: 'all',
            reuseExistingChunk: false,
            enforce: true,
        }
    });

    // @ts-expect-error There is some issue with types provided with FileManagerPlugin and CJS/ESM imports
    let zipPlugin: FileManagerPlugin[] = [];
    if (!WEBPACK_WATCH) {
        // @ts-expect-error Same as above
        zipPlugin = [new FileManagerPlugin({
            events: {
                onEnd: {
                    archive: [{
                        source: paths.dist.base,
                        destination: `${baseDist}/${name}-${targetBrowser}-${mode}-v${version}.zip`,
                    }]
                }
            }
        })];
    }

    return {
        mode: mode,
        devtool: mode === 'development' ? 'inline-source-map' : false,
        resolve: {
            alias: {
                '@utils': path.resolve(__dirname, paths.src.utils),
                '@components': path.resolve(__dirname, paths.src.components),
                '@assets': path.resolve(__dirname, paths.src.assets),
            },

            modules: [path.resolve(__dirname, paths.src.base), 'node_modules'],
            extensions: ['*', '.js', '.jsx', '.ts', '.tsx'],
        },

        entry: entries,
        output: {
            filename: (pathData) => {
                if (!pathData.chunk?.name) {
                    throw new Error('Unexpected chunk. Please make sure that all source files belong to ' +
                        'one of predefined chunks or are entrypoints');
                }
                return outputs[pathData.chunk.name];
            },
            path: path.resolve(__dirname, paths.dist.base),
            publicPath: '/',
        },

        module: {
            rules: [
                // TODO: setup ts loader to pipe files into babel loader :?
                // TODO: setup babel loader to properly handle react and friends and transpile for older browsers
                {
                    test: /\.(ts|tsx)$/,
                    include: path.resolve(__dirname, paths.src.base),
                    use: ['ts-loader']
                },
                {
                    test: /\.(js|jsx)$/,
                    include: path.resolve(__dirname, paths.src.base),
                    use: ['babel-loader']
                },
                {
                    test: /\.s[ac]ss$/i,
                    use: [{
                        loader: 'css-loader' // translates CSS into CommonJS
                    }, {
                        loader: 'sass-loader', // compiles SASS/SCSS to CSS
                    }]
                },
                {
                    test: /\.css$/,
                    resourceQuery: { not: [/raw/] },
                    use: [
                        { loader: "css-loader" }
                    ]
                },
                // More info: https://github.com/webextension-toolbox/webextension-toolbox/blob/master/src/webpack-config.js#L128
                // Using 'self' instead of 'window' so it will work in Service Worker context
                {
                    test: /webextension-polyfill[\\/]+dist[\\/]+browser-polyfill\.js$/,
                    loader: require.resolve('string-replace-loader'),
                    options: {
                        search: 'typeof browser === "undefined"',
                        replace: 'typeof self.browser === "undefined" || Object.getPrototypeOf(self.browser) !== Object.prototype'
                    }
                },
                {
                    include: path.resolve(__dirname, paths.src.assets),
                    loader: "file-loader",
                    options: {
                        name: '[path][name].[ext]',
                        context: paths.src.base,
                        postTransformPublicPath: (publicPath: string) => `(typeof browser !== 'undefined' ? browser : chrome).runtime.getURL(${publicPath});`
                    },
                },
            ]
        },

        plugins: [
            // output.clean option deletes assets generated by plugins (e.g. manifest file or .html files), so using
            // CleanWebpackPlugin directly to work around this
            new CleanWebpackPlugin({
                cleanOnceBeforeBuildPatterns: [
                    '**/*',
                ],
            }),
            new webpack.DefinePlugin({
                X_MODE: mode,
                X_BROWSER: targetBrowser,

            }),
            ...generateFileInvocations,

            // We use wrapper to load common chunks before main script
            new GenerateFiles({
                file: 'background-wrapper.js',
                content: generateBackgroundWorkerWrapper(
                    [`${libsRoot}/other.js`, `background.js`]
                ),
            }),
            new GenerateFiles({
                file: paths.dist.manifest,
                content: JSON.stringify(generateManifest(mode, targetBrowser), null, 4),
            }),
            // Part of files will be already copied by browser-runtime-geturl-loader, but not all (if you don't 
            // import asset in code, it's not copied), so we need to do this with addiitonal plugin
            new CopyPlugin({
                patterns: [{
                    from: `**`,
                    context: paths.src.assets,
                    to: ({ context, absoluteFilename }) => {
                        const assetAbsolutePath = path.resolve(paths.src.assets);
                        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                        return path.join(paths.dist.assets, absoluteFilename!.replace(assetAbsolutePath, ''));
                    }
                },
                ],
            }),
            ...zipPlugin
        ],

        optimization: {
            minimizer: [
                new TerserPlugin({
                    exclude: /node_modules/i,
                    extractComments: false,
                    terserOptions: {
                        compress: {
                            defaults: false,
                            // Uncomment next line if you would like to remove console logs in production
                            // drop_console: mode === 'production',
                        },
                        mangle: false,
                        output: {
                            // If we don't beautify, Chrome store likely will reject extension
                            beautify: true
                        },
                    },
                }),
            ],

            splitChunks: {
                chunks: 'all',
                cacheGroups
            },
        },
    };
};

export default config;
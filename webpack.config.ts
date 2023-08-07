import * as path from 'path';
import * as fs from 'fs';
import * as walkSync from 'walk-sync';
import * as webpack from 'webpack';
import * as TerserPlugin from 'terser-webpack-plugin';
// @ts-ignore No declarations for this module!
import * as GenerateFiles from 'generate-file-webpack-plugin';
import * as CopyPlugin from 'copy-webpack-plugin';
import { CleanWebpackPlugin } from 'clean-webpack-plugin';
import * as FileManagerPlugin from 'filemanager-webpack-plugin';
import {
    createPathsObject,
    joinPath,
    scriptName,
    generatePageContentForScript,
    scriptExtensions,
} from './build_helpers/webpack-utils';
import WebExtensionChuckLoaderRuntimePlugin from './build_helpers/dynamic_import_plugin/ChunkLoader';
import ServiceWorkerEntryPlugin from './build_helpers/dynamic_import_plugin/ServiceWorkerPlugin';
import type { Manifest } from 'webextension-polyfill';
import { version, name, description, author } from './package.json';


/* eslint-disable @typescript-eslint/no-unused-vars */

interface WebpackEnvs {
    WEBPACK_WATCH: boolean;
    mode?: 'development' | 'production';
    targetBrowser?: 'chrome';
}

const generateManifest = (
    mode: Exclude<WebpackEnvs['mode'], undefined>,
    targetBrowser: Exclude<WebpackEnvs['targetBrowser'], undefined>,
    paths: ReturnType<typeof createPathsObject>,
) => {
    return {
        name: name,
        description: description,
        version: version,
        author: author,
        manifest_version: 3,
        background: {
            service_worker: 'background.js',
        },
        icons: {
            '16': 'assets/images/icon16.png',
            '32': 'assets/images/icon32.png',
            '48': 'assets/images/icon48.png',
            '128': 'assets/images/icon128.png',
        },
        action: {
            default_icon: {
                '16': 'assets/images/icon16.png',
                '24': 'assets/images/icon24.png',
                '32': 'assets/images/icon32.png',
            },
            default_title: 'Click me!',
            default_popup: '/pages/popup/index.html',
        },
        options_ui: {
            page: '/pages/options/index.html',
            open_in_tab: true,
        },

        permissions: ['storage'],

        host_permissions: ['*://*.example.com/*'],

        content_scripts: [
            {
                matches: ['*://*.example.com/*'],
                js: [
                    '/contentscripts/example.js',
                ],
            },
        ],
        web_accessible_resources: [
            {
                resources: [`/${paths.dist.assets}/*`],
                matches: ['<all_urls>'],
                use_dynamic_url: true,
            },
            {
                resources: [`/${paths.dist.chunks}/*`],
                matches: ['<all_urls>'],
                use_dynamic_url: true,
            },
        ],
    } satisfies Manifest.WebExtensionManifest;
};

const baseSrc = './src';
const baseDist = './dist';

const config = async (env: WebpackEnvs): Promise<webpack.Configuration> => {
    const { mode = 'development', targetBrowser = 'chrome', WEBPACK_WATCH } = env;

    const paths = createPathsObject(baseSrc, joinPath(baseDist, targetBrowser));

    const pageTemplate = fs.readFileSync(paths.src.pageHtmlTemplate, {
        encoding: 'utf-8',
    });

    const entries: { [id: string]: string } = {
        backgroundScript: paths.src.background,
    };
    const outputs: { [id: string]: string } = {
        backgroundScript: paths.dist.background,
    };

    const generateFileInvocations: GenerateFiles[] = [];

    const pages = walkSync(paths.src.pages, {
        globs: scriptExtensions.map((ext) => '**/*' + ext),
        directories: false,
    });
    console.log('Pages:', pages);
    pages.forEach((page) => {
        const cleanName = scriptName(page);
        entries[cleanName] = joinPath(paths.src.pages, page);
        outputs[cleanName] = joinPath(paths.dist.pages, cleanName + '.js');

        const scriptsToInject = [
            `/${paths.dist.pages}/${cleanName}.js`,
        ];

        generateFileInvocations.push(
            new GenerateFiles({
                file: joinPath(paths.dist.pages, `${cleanName}.html`),
                content: generatePageContentForScript(pageTemplate, {
                    scripts: scriptsToInject
                        .map((url) => {
                            return `<script src="${url}" async></script>`;
                        })
                        .join('\n'),
                }),
            })
        );
    });

    // TODO: somehow automatically inject these in generated manifest?
    const contentscripts = walkSync(paths.src.contentscripts, {
        globs: scriptExtensions.map((ext) => '**/*' + ext),
        directories: false,
    });
    console.log('Content scripts:', contentscripts);
    contentscripts.forEach((cs) => {
        const cleanName = scriptName(cs);
        entries[cleanName] = joinPath(paths.src.contentscripts, cs);
        outputs[cleanName] = joinPath(paths.dist.contentscripts, cleanName + '.js');
    });

    // @ts-expect-error There is some issue with types provided with FileManagerPlugin and CJS/ESM imports
    let zipPlugin: FileManagerPlugin[] = [];
    if (!WEBPACK_WATCH) {
        zipPlugin = [
            // @ts-expect-error Same as above
            new FileManagerPlugin({
                events: {
                    onEnd: {
                        archive: [
                            {
                                source: paths.dist.base,
                                destination: `${baseDist}/${name}-${targetBrowser}-${mode}-v${version}.zip`,
                            },
                        ],
                    },
                },
            }),
        ];
    }

    const babelOptions = {
        presets: [
            ['@babel/preset-env', {
                targets: {
                    chrome: 90,
                    firefox: 90,
                    safari: 14,
                }
            }],
            [
                '@babel/preset-react',
                {
                    runtime: 'automatic',
                    development: mode === 'development',
                },
            ],
        ],
    };

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
            filename: (pathData, assetInfo) => {
                if (!pathData.chunk) {
                    throw new Error('pathData.chunk not defined for some reason');
                }

                const predefinedName = outputs[pathData.chunk.name || ''];
                if (predefinedName) return predefinedName;
                const filename = (pathData.chunk.name || pathData.chunk.id) + '.js';
                return path.join(paths.dist.chunks, filename);
            },
            chunkFilename: `${paths.dist.chunks}/[id].js`,
            chunkFormat: 'array-push',
            chunkLoadTimeout: 5000,
            chunkLoading: 'jsonp',
            path: path.resolve(__dirname, paths.dist.base),
            publicPath: '/',
            environment: {
                dynamicImport: true,
            }
        },

        module: {
            rules: [
                {
                    test: /\.(ts|tsx)$/,
                    resourceQuery: { not: [/raw/] },
                    include: path.resolve(__dirname, paths.src.base),
                    use: [
                        {
                            loader: 'babel-loader',
                            options: babelOptions,
                        },
                        {
                            loader: 'ts-loader',
                        },
                    ],
                },
                {
                    test: /\.(js|jsx)$/,
                    resourceQuery: { not: [/raw/] },
                    include: path.resolve(__dirname, paths.src.base),
                    use: {
                        loader: 'babel-loader',
                        options: babelOptions,
                    },
                },
                {
                    test: /\.s[ac]ss$/i,
                    resourceQuery: { not: [/raw/] },
                    use: [
                        {
                            loader: 'to-string-loader',
                        },
                        {
                            loader: 'css-loader',
                            options: {
                                url: false,
                            },
                        },
                        {
                            loader: 'sass-loader',
                        },
                    ],
                },
                {
                    test: /\.css$/,
                    use: [
                        {
                            loader: 'to-string-loader',
                        },
                        {
                            loader: 'css-loader',
                            options: {
                                url: false,
                            },
                        },
                    ],
                },
                {
                    include: path.resolve(__dirname, paths.src.assets),
                    loader: 'file-loader',
                    resourceQuery: { not: [/raw/] },
                    options: {
                        name: '[path][name].[ext]',
                        context: paths.src.base,
                    },
                },
                {
                    resourceQuery: /raw/,
                    type: 'asset/source',
                },
            ],
        },

        plugins: [
            // output.clean option deletes assets generated by plugins (e.g. manifest file or .html files), so using
            // CleanWebpackPlugin directly to work around this
            new CleanWebpackPlugin({
                cleanOnceBeforeBuildPatterns: ['**/*'],
            }),
            new webpack.DefinePlugin({
                X_MODE: JSON.stringify(mode),
                X_BROWSER: JSON.stringify(targetBrowser),
            }),

            new WebExtensionChuckLoaderRuntimePlugin({backgroundWorkerEntry: targetBrowser === 'chrome' ? 'backgroundScript' : undefined}),
            ...(targetBrowser === 'chrome' ? [new ServiceWorkerEntryPlugin({}, 'backgroundScript')] : []),

            // TODO: would be great to generate manifest after chunks are compiled and add initial chunks for each
            // entrypoint directly to manifest to allow them to be loaded and parsed in paralel. Same for generated pages
            ...generateFileInvocations,
            new GenerateFiles({
                file: paths.dist.manifest,
                content: JSON.stringify(generateManifest(mode, targetBrowser, paths), null, 4),
            }),

            // Part of files will be already copied by browser-runtime-geturl-loader, but not all (if you don't
            // import asset in code, it's not copied), so we need to do this with addiitonal plugin
            new CopyPlugin({
                patterns: [
                    {
                        from: `**`,
                        context: paths.src.assets,
                        to: ({ context, absoluteFilename }) => {
                            const assetAbsolutePath = path.resolve(paths.src.assets);
                            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                            return path.join(paths.dist.assets, absoluteFilename!.replace(assetAbsolutePath, ''));
                        },
                    },
                ],
            }),
            ...zipPlugin,
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
                            beautify: true,
                        },
                    },
                }),
            ],

            splitChunks: {
                chunks: 'all',
                automaticNameDelimiter: '-',
                minChunks: 2,
            },
        },
    };
};

export default config;

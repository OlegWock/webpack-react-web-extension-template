import * as path from 'path';

export const scriptExtensions = ['.tsx', '.jsx', '.ts', '.js'];

export const isScript = (filename: string) => scriptExtensions.some((ext) => filename.endsWith(ext));

export const scriptName = (filename: string) =>
    scriptExtensions.reduce((name, extension) => name.replace(extension, ''), filename);

export const joinPath = (...args: string[]) => {
    // preserve dot on start of path
    const hasDot = args.length && args[0].startsWith('./');
    const res = path.join(...args);
    if (hasDot) return './' + res;
    return res;
};

export const createPathsObject = (baseSrc: string, baseDist: string) => {
    return {
        src: {
            base: baseSrc,
            background: joinPath(baseSrc, 'background.ts'),
            contentscripts: joinPath(baseSrc, 'contentscripts'),
            pages: joinPath(baseSrc, 'pages'),
            pageHtmlTemplate: './build_helpers/page_template.html',

            utils: joinPath(baseSrc, 'utils'),
            components: joinPath(baseSrc, 'components'),
            assets: joinPath(baseSrc, 'assets'),
        },
        dist: {
            base: baseDist,
            background: 'background.js',
            contentscripts: 'contentscripts',
            pages: 'pages',
            libs: 'libs',
            assets: 'assets',
            chunks: 'chunks',

            manifest: 'manifest.json',
        },
    };
};

export const generatePageContentForScript = (pageTemplate: string, substitutions: { [key: string]: string }) => {
    let result = pageTemplate;
    for (const key of Object.keys(substitutions)) {
        const value = substitutions[key];
        result = result.replace(`[[${key}]]`, value);
    }
    return result;
};

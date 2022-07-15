declare module '@assets/*' {
    const url: string;
    export default url;
}

declare const X_MODE: 'development' | 'production';
declare const X_BROWSER: 'chrome';
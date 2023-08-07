import { AnnoyingPopup } from '@components/AnnoyingPopup';
import txtEmbedded from '@assets/test.txt?raw';
import { loadTextAsset } from '@utils/network';
import { injectComponent } from 'inject-react-anywhere';
import browser from 'webextension-polyfill';
import v18 from 'inject-react-anywhere/v18';
import txt from '@assets/test.txt';


const main = async () => {
    const txtAssetContent = await loadTextAsset(txt);
    const controller = await injectComponent(
        AnnoyingPopup,
        {
            content: (
                <div>
                    <button onClick={() => import('@utils/bigModule').then(m => m.lazyAlert())}>Load async chunk</button>
                    <p>This is demonstration of content script which injects React component on 3rd party site.</p>
                    <p>{txtAssetContent}</p>
                    <p>This is same content, but emedded directly in source code:</p>
                    <p>{txtEmbedded}</p>
                </div>
            ),
        },
        {
            mountStrategy: v18,
        }
    );

    document.body.append(controller.shadowHost);
};

main();
console.log('Hello from extension script', browser.runtime.id);
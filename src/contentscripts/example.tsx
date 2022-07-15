import { AnnoyingPopup } from '@components/AnnoyingPopup';
import { injectComponent } from 'inject-react-anywhere';
import v18 from 'inject-react-anywhere/v18';

const main = async () => {
    const controller = await injectComponent(
        AnnoyingPopup,
        {
            content: (
                <div>
                    <p>This is demonstration of content script which injects React component on 3rd party site.</p>
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

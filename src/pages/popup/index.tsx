import { injectStyles, mountPage } from '@utils/mount';
import logo from '@assets/images/icon128.png';
import style from './styles.scss';
import browser from 'webextension-polyfill';

const Popup = () => {
    return (
        <div className="Popup">
            <img src={logo} />
            <div className="text-wrapper">Hello! I'm extension's popup. Nice to meet you.</div>
        </div>
    );
};

injectStyles([style]);
mountPage(<Popup />);
console.log("I'm popup", browser);

import('@utils/bigModule').then(module => module.lazyFunction());

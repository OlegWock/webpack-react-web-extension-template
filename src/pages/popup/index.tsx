import { injectStyles, mountPage } from '@utils/mount';

import style from './styles.scss';

const Popup = () => {
    return <div className="Popup">Hello! I'm extension's popup. Nice to meet you.</div>;
};

injectStyles([style]);
mountPage(<Popup />);

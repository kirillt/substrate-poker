import {pretty} from "oo7-substrate";
import { Bond } from 'oo7';

const NodeRSA = require('node-rsa');

export const hand = new Bond();
export const flop = new Bond();
export const turn = new Bond();
export const river = new Bond();

export const NAME_TO_BOND = new Map([
    ['hand', hand],
    ['flop', flop],
    ['turn', turn],
    ['river', river]
]);

export function generate () {
    for (let entry of NAME_TO_BOND) {
        generateKeyPair(entry[0], entry[1]);
    }
}

export function load () {
    for (let entry of NAME_TO_BOND) {
        console.log(entry[0]);
        console.log(entry[1]);
        loadKeyIntoBond(entry[0], entry[1]);
    }
}

export function clear () {
    console.assert(game.user.isReady());
    NAME_TO_BOND.forEach((field, bond) => {
        clearStorage(field);
        bond.reset();
    });
}

function clearStorage (field) {
    console.log(`Clearing '${field}' key`);
    localStorage.setItem(modulusField(field), "");
    localStorage.setItem(exponentField(field), "");
}

function loadKeyIntoBond (field, bond) {
    console.log(`Loading '${field}' key`);

    let modulus = localStorage.getItem(modulusField(field));
    let exponent = localStorage.getItem(exponentField(field));

    if (modulus !== "" && exponent !== "") {
        modulus = Buffer.from(modulus, 'hex');
        exponent = Buffer.from(exponent, 'hex');
        console.assert(modulus.length === 32, "public key must consist of 32 bytes");
        console.assert(exponent.length === 32, "private key must consist of 32 bytes");

        bond.changed({ modulus: modulus, exponent: exponent });
    } else {
        bond.reset();
    }
}

function generateKeyPair (field, bond) {
    console.log(`Generating '${field}' key`);
    const key = new NodeRSA({b: 256}, 'components', 'browser');

    const components = key.exportKey('components');
    console.assert(components.e === 65537);

    //keys are stored in little-endian format
    const modulus = components.n.slice(-32).reverse();
    const exponent = components.d.slice(-32).reverse();
    console.assert(modulus.length === 32, "public key must consist of 32 bytes");
    console.assert(exponent.length === 32, "private key must consist of 32 bytes");

    localStorage.setItem(modulusField(field), Buffer.from(modulus).toString('hex'));
    localStorage.setItem(exponentField(field), Buffer.from(exponent).toString('hex'));
    bond.changed({modulus: modulus, exponent: exponent});
}

const STORAGE_PREFIX = 'blockchain_poker';
const MODULUS_SUFFIX = 'key_modulus';
const EXPONENT_SUFFIX = 'key_exponent';

function modulusField (keyName) {
    let result = `${STORAGE_PREFIX}_${pretty(game.user._value)}_${keyName}_${MODULUS_SUFFIX}`;
    console.log(`Using this local storage key: ${result}`);
    return result;
}

function exponentField (keyName) {
    let result = `${STORAGE_PREFIX}_${pretty(game.user._value)}_${keyName}_${EXPONENT_SUFFIX}`;
    console.log(`Using this local storage key: ${result}`);
    return result;
}
import test from 'node:test';
import assert from 'node:assert/strict';
import {escapeHtml, cents, money, cartTotal, readableError} from '../app/static/utils.js';

test('API-controlled text is escaped before insertion into HTML and attributes', () => {
  assert.equal(escapeHtml('<img src=x onerror="alert(1)"> & \'test\''), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;test&#39;');
});

test('money uses exact cents, including totals above JavaScript safe integer', () => {
  assert.equal(cents('25.50'), 2550n);
  assert.equal(cents('100'), 10000n);
  assert.throws(() => cents('1.001'));
  assert.throws(() => cents('NaN'));
  const products = [{id:1,price:'9999999999.99'},{id:2,price:'25.50'}];
  assert.equal(cartTotal(new Map([[1,1000000],[2,3]]),products), 999999999999007650n);
  assert.equal(money('25.50'), '25,50 ₽');
});

test('missing products do not inflate the cart total', () => {
  assert.equal(cartTotal(new Map([[1,2],[99,3]]), [{id:1,price:'100.00'}]), 20000n);
});

test('structured validation errors retain field and server message', () => {
  assert.equal(readableError({error:{message:'Ошибка',details:[{location:['body','items',0,'quantity'],message:'Больше нуля'}]}}), 'Ошибка · body.items.0.quantity: Больше нуля');
  assert.equal(readableError(null), 'Не удалось выполнить запрос');
});

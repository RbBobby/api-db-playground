export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}

export function cents(value) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) throw new Error('Некорректная денежная сумма');
  return BigInt(match[1]) * 100n + BigInt((match[2] || '').padEnd(2, '0'));
}

export function money(value) {
  const amount = typeof value === 'bigint' ? value : cents(value);
  return `${new Intl.NumberFormat('ru-RU').format(amount / 100n)},${String(amount % 100n).padStart(2, '0')} ₽`;
}

export function cartTotal(cart, products) {
  return [...cart].reduce((sum, [id, quantity]) => {
    const product = products.find((item) => item.id === id);
    return sum + (product ? cents(product.price) * BigInt(quantity) : 0n);
  }, 0n);
}

export function readableError(data, fallback = 'Не удалось выполнить запрос') {
  const error = data?.error;
  if (!error) return fallback;
  const details = (error.details || []).map((entry) => `${(entry.location || []).join('.')}: ${entry.message}`).join('; ');
  return [error.message, details].filter(Boolean).join(' · ');
}

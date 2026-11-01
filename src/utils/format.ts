import { BigNumber, BigNumberish, ethers } from 'ethers';

const isZeroValue = (value: BigNumberish): boolean => {
  try {
    return BigNumber.from(value).isZero();
  } catch {
    return false;
  }
};

/**
 * Format a raw on-chain amount for humans: trims trailing zeros and caps the
 * fraction so a uint256 cannot produce a 78-character column.
 *
 * A non-zero value that would truncate to nothing renders as `<0.000001`
 * (or `<1` with zero fraction digits) rather than a misleading `0`.
 */
export const formatAmount = (value: BigNumberish, decimals: number, maxFractionDigits = 6): string => {
  const raw = ethers.utils.formatUnits(value, decimals);
  if (!raw.includes('.')) return raw;

  const trimmed = raw.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  const [whole, fraction] = trimmed.split('.');
  if (!fraction) return whole;

  const zero = isZeroValue(value);
  const capped = maxFractionDigits < 1 ? '' : fraction.slice(0, maxFractionDigits);

  if (!zero && /^0+$/.test(whole) && /^0*$/.test(capped)) {
    return maxFractionDigits < 1 ? '<1' : `<0.${'0'.repeat(maxFractionDigits - 1)}1`;
  }
  if (!capped) return whole;
  return `${whole}.${capped}`;
};

/** Same as formatAmount but always carries an explicit sign. Zero stays unsigned. */
export const formatSigned = (delta: BigNumberish, decimals: number, maxFractionDigits = 6): string => {
  const value = BigNumber.from(delta);
  if (value.isZero()) return '0';

  const negative = value.isNegative();
  const absolute = negative ? value.mul(-1) : value;
  return `${negative ? '-' : '+'}${formatAmount(absolute, decimals, maxFractionDigits)}`;
};

export const shortAddress = (address: string, lead = 6, tail = 4): string => {
  if (address.length <= lead + tail + 2) return address;
  return `${address.slice(0, lead)}...${address.slice(-tail)}`;
};

/**
 * Contract-supplied text (symbols, names) goes into terminals and log files, so
 * strip control/format characters that could rewrite a line, and cap the width.
 */
export const sanitizeLabel = (text: string, maxLength = 12): string => {
  const cleaned = text
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e]/g, '')
    .trim();

  if (!cleaned) return '';
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}~` : cleaned;
};

export type Align = 'left' | 'right';

/** Render an aligned text table. Trailing whitespace is stripped per line. */
export const renderTable = (headers: readonly string[], rows: readonly string[][], aligns: readonly Align[]): string => {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => (row[column] ?? '').length))
  );

  const formatRow = (cells: readonly string[]): string =>
    cells
      .map((cell, column) => (aligns[column] === 'right' ? cell.padStart(widths[column]) : cell.padEnd(widths[column])))
      .join('  ')
      .trimEnd();

  const divider = widths.map((width) => '-'.repeat(width)).join('  ');
  return [formatRow(headers), divider, ...rows.map(formatRow)].join('\n');
};

const colorEnabled = (): boolean => Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

export const color = (text: string, code: number): string =>
  colorEnabled() ? `\u001b[${code}m${text}\u001b[0m` : text;

export const green = (text: string): string => color(text, 32);
export const red = (text: string): string => color(text, 31);
export const dim = (text: string): string => color(text, 2);

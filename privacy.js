/**
 * Data Privacy & PII (Personally Identifiable Information) Masking Engine
 * Berfungsi menyamarkan data sensitif sebelum dikirim ke AI dan memetakan kembali jika diperlukan.
 */

export function maskSensitiveData(text) {
	if (typeof text !== "string" || !text.trim()) {
		return {
			maskedText: text || "",
			mappingTable: {},
			detectedCount: 0,
			types: [],
		};
	}

	const mappingTable = {};
	const types = new Set();
	let counter = 1;
	let processedText = text;

	const registerToken = (type, originalValue) => {
		types.add(type);
		const token = `[${type}_${counter++}]`;
		mappingTable[token] = originalValue;
		return token;
	};

	// 1. Email addresses (e.g. user@example.com)
	processedText = processedText.replace(
		/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
		(match) => registerToken("EMAIL_RAHASIA", match),
	);

	// 2. NIK / KTP / Passport / 16-digit ID numbers
	processedText = processedText.replace(
		/\b\d{16}\b/g,
		(match) => registerToken("NIK_TERLINDUNGI", match),
	);

	// 3. Indonesian & International Phone Numbers (+62, 62, 08xx, etc.)
	processedText = processedText.replace(
		/(?:\+62|62|08)[0-9\s-]{8,14}[0-9]/g,
		(match) => {
			const cleaned = match.replace(/[\s-]/g, "");
			if (cleaned.length >= 10 && cleaned.length <= 15) {
				return registerToken("NO_HP_TERLINDUNGI", match);
			}
			return match;
		},
	);

	// 4. Nomor Rekening Bank / Kartu Kredit (10 - 19 digit dengan spasi/pemisah)
	processedText = processedText.replace(
		/\b(?:\d{4}[-\s]?){3}\d{4}\b|\b\d{10,14}\b/g,
		(match) => {
			const digitsOnly = match.replace(/\D/g, "");
			if (digitsOnly.length >= 10 && digitsOnly.length <= 19) {
				return registerToken("NO_REKENING_TERLINDUNGI", match);
			}
			return match;
		},
	);

	// 5. Gaji / Nominal Finansial Sensitif (misal: Rp 15.000.000, Rp. 50,000,000, IDR 20.000.000)
	processedText = processedText.replace(
		/(?:Rp\.?|IDR)\s*[\d,.]+/gi,
		(match) => registerToken("NOMINAL_FINANSIAL", match),
	);

	return {
		maskedText: processedText,
		mappingTable,
		detectedCount: Object.keys(mappingTable).length,
		types: Array.from(types),
	};
}

export function unmaskSensitiveData(maskedText, mappingTable) {
	if (typeof maskedText !== "string" || !mappingTable) {
		return maskedText;
	}

	let restoredText = maskedText;
	for (const [token, original] of Object.entries(mappingTable)) {
		restoredText = restoredText.replaceAll(token, original);
	}
	return restoredText;
}

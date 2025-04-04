export async function loadLemmatizationMap() {
    const lemmatizationList = new Map<string, string>();
    const lemmatizationFile = await Bun.file("./utils/lemmatization-en.txt").text();
    const lemmatizationLines = lemmatizationFile.split("\n");
    for (const line of lemmatizationLines) {
        const [word, lemma] = line.trim().split(/\s+/);
        if (word && lemma) {
            lemmatizationList.set(word, lemma);
        }
    }
    return lemmatizationList;
}

export const lemmatizationList = await loadLemmatizationMap();
  
export function lemmatizeWord(word: string): string {
    const lowerWord = word.toLowerCase().trim();
    if (lemmatizationList.has(lowerWord)) {
        const lemma = lemmatizationList.get(lowerWord) || word;
        return lemma;
    }
    return word;
}

export function lemmatizeText(text: string): string[] {
    if (!text) return [];
    const words = text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean);
    return words.map((word) => lemmatizeWord(word)); 
}

export function listToString(list: string[]) {
    return list.join(" ");
}
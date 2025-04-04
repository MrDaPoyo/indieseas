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
  
export function lemmatizeWord(word: string, lemmatizationList: Map<string, string>): string {
    const lowerWord = word.toLowerCase().trim();
    if (lemmatizationList.has(lowerWord)) {
        const lemma = lemmatizationList.get(lowerWord) || word;
        return lemma;
    }
    return word;
}

export function lemmatizeText(text: string, lemmatizationList: Map<string, string>) {
    const words = text.split(/\s+/);
    return words.map((word) => lemmatizeWord(word, lemmatizationList)); 
}

export function listToString(list: string[]) {
    return list.join(" ");
}
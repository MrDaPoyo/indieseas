export default function customFetch(url: string, options = { headers: {} }) {

    const customHeaders = {
        "User-Agent": "indieseas/0.1 (+https://indieseas.net)",
        ...options.headers,

    };

    const mergedOptions = {

        ...options,
        RequestRedirect: "follow",
        headers: customHeaders,

    };

    return fetch(url, mergedOptions);

}
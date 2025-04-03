import customFetch from './fetch';

interface RobotsRule {
    userAgent: string;
    allowedPaths: string[];
    disallowedPaths: string[];
}

export async function checkRobotsTxt(url: string): Promise<RobotsResult | null> {
    try {
        const baseUrl = new URL(url);
        const robotsUrl = `${baseUrl.origin}/robots.txt`;

        const response = await customFetch(robotsUrl, { headers: { timeout: 5000 }});
        const robotsTxt = await response.text();

        if (!response.ok) {
            console.warn(`robots.txt not found at ${robotsUrl} with response code ${response.status}`);
            return null;
        }
        if (!robotsTxt) {
            console.warn(`robots.txt is empty at ${robotsUrl}`);
            return null;
        }
        if (robotsTxt.length > 5000) {
            console.warn(`robots.txt is too long at ${robotsUrl}`);
            return null;
        }

        const rules = await parseRobotsTxt(robotsTxt);
        
        const allowedPaths = await getAllowedPaths(rules, ['*', 'indieseas'], baseUrl.origin);
        return {
            allowed: [allowedPaths['*'].allowed, allowedPaths['indieseas'].allowed],
            disallowed: [allowedPaths['*'].disallowed, allowedPaths['indieseas'].disallowed],
        };
    } catch (error) {
        console.warn(`Couldn't fetch robots.txt: ${error instanceof Error ? error.message : error}`);
        return null;
    }
}

function parseRobotsTxt(content: string): RobotsRule[] {
    const lines = content.split('\n');
    const rules: RobotsRule[] = [];
    
    let currentRule: RobotsRule | null = null;
    if (!lines.length) {
        console.warn('robots.txt is empty');
        return rules;
    }
    for (let line of lines) {
        line = line.split('#')[0].trim().toLowerCase();
        if (!line) continue;

        if (line.startsWith('user-agent:')) {
            const userAgent = line.substring('user-agent:'.length).trim();
            if (currentRule && currentRule.userAgent === userAgent) {
            } else {
                // Start a new rule
                currentRule = { userAgent, allowedPaths: [], disallowedPaths: [] };
                rules.push(currentRule);
            }
        } 
        else if (line.startsWith('allow:') && currentRule) {
            const path = line.substring('allow:'.length).trim();
            if (path) {
                currentRule.allowedPaths.push(path);
            }
        } 
        else if (line.startsWith('disallow:') && currentRule) {
            const path = line.substring('disallow:'.length).trim();
            if (path) {
                currentRule.disallowedPaths.push(path);
            }
        }

        else if (!currentRule) {
            currentRule = { userAgent: '*', allowedPaths: [], disallowedPaths: [] };
            rules.push(currentRule);
            
            if (line.startsWith('allow:')) {
                const path = line.substring('allow:'.length).trim();
                if (path) {
                    currentRule.allowedPaths.push(path);
                }
            } else if (line.startsWith('disallow:')) {
                const path = line.substring('disallow:'.length).trim();
                if (path) {
                    currentRule.disallowedPaths.push(path);
                }
            }
        }
    }

    return rules;
}

interface RobotsResult {
    allowed: string[];
    disallowed: string[];
}

function getAllowedPaths(rules: RobotsRule[], userAgents: string[], baseUrl: string): RobotsResult {
    const result: RobotsResult = {};
    const normalizedUserAgents = userAgents.map(ua => ua.toLowerCase());
    
    // Initialize result with all requested user agents
    normalizedUserAgents.forEach(ua => {
        result[ua] = { allowed: [], disallowed: [] };
    });

    // Find wildcard rules first to use as fallback
    const wildcardRules = rules.filter(rule => rule.userAgent === '*');
    
    // Find applicable rules for each user agent
    for (const ua of normalizedUserAgents) {
        const specificRules = rules.filter(rule => rule.userAgent === ua);
        const applicableRules = specificRules.length > 0 ? specificRules : wildcardRules;
        
        if (applicableRules.length === 0) {
            // No specific rules and no wildcard rules, so everything is allowed by default
            result[ua].allowed = [`${baseUrl}/`];
            continue;
        }

        for (const rule of applicableRules) {
            // If no disallow rules, everything is allowed
            if (rule.disallowedPaths.length === 0) {
                result[ua].allowed = [`${baseUrl}/`];
                continue;
            }
            
            // Add all explicitly allowed paths
            result[ua].allowed.push(...rule.allowedPaths.map(path => {
                path = path.replace(/\*/g, '');
                if (!path.startsWith('/')) {
                    path = '/' + path;
                }
                return baseUrl + path;
            }));
            
            // Add all disallowed paths
            result[ua].disallowed.push(...rule.disallowedPaths.map(path => {
                path = path.replace(/\*/g, '');
                if (!path.startsWith('/')) {
                    path = '/' + path;
                }
                return baseUrl + path;
            }));
        }
        
        // If no specific allowed paths but disallow paths exist, root path is allowed
        if (result[ua].allowed.length === 0 && !result[ua].disallowed.includes(`${baseUrl}/`)) {
            result[ua].allowed.push(`${baseUrl}/`);
        }
    }
    
    return result;
}
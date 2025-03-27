import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import * as schema from "./schema";

const sqlite = new Database("indiesearch.db");
export let db = drizzle(sqlite, { schema: { buttons: schema.buttons } });

export function retrieveAllButtons() {
    try {
        return db.query.buttons.findMany();
    } catch (error) {
        return false;
    }
}

export function insertButton(button: schema.Button) {
    try {
        db.insert(schema.buttons).values(button).then(() => {
            console.log("Inserted button: " + button.hash);
        });
        return true;
    } catch (error) {
        console.error(error);
        return false;
    }
}
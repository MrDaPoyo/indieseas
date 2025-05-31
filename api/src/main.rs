use serde::{ Deserialize, Serialize };
use serde_json::{ json, Value };
use sqlx::postgres::PgPoolOptions;
use sqlx::Row;
use sqlx::PgPool;
use std::{ collections::HashMap, env };
use tokio::net::TcpListener;
use dotenv::dotenv;
use reqwest;
use tracing::{ error, info };

use axum::{
	extract::{ Query, State },
	http::{ StatusCode, Method },
	response::Json,
	routing::{ get, post },
	Router,
};
use tower_http::cors::{ CorsLayer, Any };

#[derive(Debug, Deserialize)]
struct VectorizeRequest {
	text: String,
}

#[derive(Debug, Serialize)]
struct VectorizeResponse {
	vector: Vec<f32>,
}

async fn stats_handler(State(pool): State<PgPool>) -> Result<
	Json<HashMap<String, i64>>,
	StatusCode
> {
	let websites_row: (i64,) = sqlx
		::query_as("SELECT COUNT(*) FROM websites")
		.fetch_one(&pool).await
		.map_err(|e| {
			error!("Database error in stats_handler (websites count): {}", e);
			StatusCode::INTERNAL_SERVER_ERROR
		})?;

	let buttons_row: (i64,) = sqlx
		::query_as("SELECT COUNT(*) FROM buttons")
		.fetch_one(&pool).await
		.map_err(|e| {
			error!("Database error in stats_handler (buttons count): {}", e);
			StatusCode::INTERNAL_SERVER_ERROR
		})?;

	let mut stats = HashMap::new();
	stats.insert("totalWebsites".to_string(), websites_row.0);
	stats.insert("totalButtons".to_string(), buttons_row.0);

	Ok(Json(stats))
}

async fn search_handler(
	Query(params): Query<HashMap<String, String>>,
	State(pool): State<PgPool>
) -> Result<Json<Value>, StatusCode> {
	let query = params.get("query").ok_or(StatusCode::BAD_REQUEST)?;

	let ai_url = env::var("AI_URL").map_err(|e| {
		error!("AI_URL environment variable not set: {}", e);
		StatusCode::INTERNAL_SERVER_ERROR
	})?;

	let client = reqwest::Client::new();
	let response = client
		.post(&format!("{}/vectorize", ai_url))
		.json(&json!({ "text": query }))
		.send().await
		.map_err(|e| {
			error!("Failed to send request to AI service: {}", e);
			StatusCode::INTERNAL_SERVER_ERROR
		})?;

	let vector_data: Value = response.json().await.map_err(|e| {
		error!("Failed to parse AI service response: {}", e);
		StatusCode::INTERNAL_SERVER_ERROR
	})?;

	let vector = vector_data["vector"]
		.as_array()
		.ok_or_else(|| {
			error!("AI service response missing 'vector' array field");
			StatusCode::INTERNAL_SERVER_ERROR
		})?
		.iter()
		.map(|v| v.as_f64().unwrap_or(0.0))
		.collect::<Vec<f64>>();

	let vector_string = format!(
		"[{}]",
		vector
			.iter()
			.map(|v| v.to_string())
			.collect::<Vec<_>>()
			.join(",")
	);

	// super mega propietary algorithm
	let rows = sqlx
		::query(
			"WITH nearest_matches AS (
			SELECT id, website, type, embedding <=> $1::vector AS distance
			FROM websites_index
			ORDER BY distance ASC
			LIMIT 1000
		),
		similarity_scores AS (
			SELECT website, type, 1 - distance AS similarity,
				CASE type
					WHEN 'title' THEN (1 - distance) * 2.0
					WHEN 'description' THEN (1 - distance) * 1.5
					WHEN 'corpus' THEN (1 - distance) * 1.0
					ELSE (1 - distance)
				END AS weighted_similarity
			FROM nearest_matches
		),
		aggregated_scores AS (
			SELECT website, SUM(weighted_similarity) as total_similarity,
				COUNT(DISTINCT type) as matched_types_count,
				ARRAY_AGG(DISTINCT type) as matched_types_list
			FROM similarity_scores
			GROUP BY website
		)
		SELECT ag.website, ag.total_similarity, ag.matched_types_count, 
			   ag.matched_types_list, vu.title, vu.description, 
			   vu.amount_of_buttons, vu.url_id
		FROM aggregated_scores ag
		JOIN visited_urls vu ON ag.website = vu.path
		WHERE ag.total_similarity >= 0.3
		ORDER BY ag.total_similarity DESC
		LIMIT 50"
		)
		.bind(&vector_string)
		.fetch_all(&pool).await
		.map_err(|e| {
			error!("Database error in search query: {}", e);
			StatusCode::INTERNAL_SERVER_ERROR
		})?;

	let results: Vec<Value> = rows
		.iter()
		.map(|row| {
			json!({
				"website": row.get::<String, _>("website"),
				"title": row.get::<String, _>("title"),
				"description": row.get::<Option<String>, _>("description"),
				"amount_of_buttons": row.get::<i32, _>("amount_of_buttons"),
				"score": row.get::<f64, _>("total_similarity"),
				"matched_types_count": row.get::<i64, _>("matched_types_count"),
				"website_id": row.get::<i32, _>("url_id")
			})
		})
		.collect();

	Ok(
		Json(
			json!({
		"results": results,
		"metadata": {
			"originalDbCount": rows.len(),
			"finalCount": results.len()
		}
	})
		)
	)
}

async fn random_website_handler(State(pool): State<PgPool>) -> Result<Json<Value>, StatusCode> {
	let row: (String, String, Option<String>, i32) = sqlx
		::query_as(
			"SELECT url, title, description, amount_of_buttons FROM websites ORDER BY RANDOM() LIMIT 1"
		)
		.fetch_one(&pool).await
		.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

	let result =
		json!({
		"website": row.0,
		"title": row.1,
		"description": row.2,
		"amount_of_buttons": row.3
	});

	Ok(Json(result))
}

async fn retrieve_all_buttons_handler(State(pool): State<PgPool>) -> Result<
	Json<Vec<Value>>,
	StatusCode
> {
	let query = "SELECT id, button_text, color_tag, website_url FROM buttons ORDER BY id";

	let rows = sqlx
		::query(query)
		.fetch_all(&pool).await
		.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

	let buttons: Vec<Value> = rows
		.iter()
		.map(|row| {
			json!({
				"id": row.get::<i32, _>("id"),
				"button_text": row.get::<String, _>("button_text"),
				"color_tag": row.get::<Option<String>, _>("color_tag"),
				"website_url": row.get::<String, _>("website_url")
			})
		})
		.collect();

	Ok(Json(buttons))
}

async fn check_indexed_handler(
	Query(params): Query<HashMap<String, String>>,
	State(pool): State<PgPool>
) -> Result<Json<Value>, StatusCode> {
	let website = params.get("website").ok_or(StatusCode::BAD_REQUEST)?;

	let row: (i64,) = sqlx
		::query_as("SELECT COUNT(*) FROM websites_index WHERE website = $1")
		.bind(website)
		.fetch_one(&pool).await
		.map_err(|e| {
			error!("Database error in check_indexed_handler: {}", e);
			StatusCode::INTERNAL_SERVER_ERROR
		})?;

	let is_indexed = row.0 > 0;
	Ok(Json(json!({ "indexed": is_indexed })))
}

async fn vectorize_handler(State(pool): State<PgPool>) -> Result<Json<Value>, StatusCode> {
	let response = reqwest
		::get("http://localhost:8888/vectorize").await
		.map_err(|_| StatusCode::BAD_GATEWAY)?;

	let vector_data: Value = response.json().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

	let vector: Vec<f32> = vector_data["vector"]
		.as_array()
		.ok_or(StatusCode::INTERNAL_SERVER_ERROR)?
		.iter()
		.map(|v| v.as_f64().unwrap_or(0.0) as f32)
		.collect();

	Ok(Json(json!({"vector": vector})))
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
	dotenv().ok();
	
	tracing_subscriber::fmt::init();

	info!("Starting search server...");
	
	let pool: PgPool = PgPoolOptions::new()
		.max_connections(20)
		.connect(&env::var("DB_URL").expect("DB_URL must be set"))
		.await?;

	let app = Router::new()
		.route("/stats", get(stats_handler))
		.route("/search", get(search_handler))
		.route("/random", get(random_website_handler))
		.route("/retrieveAllButtons", get(retrieve_all_buttons_handler))
		.route("/check-indexed", get(check_indexed_handler))
		.route("/vectorize", post(vectorize_handler))
		.layer(
			CorsLayer::new()
				.allow_origin(Any)
				.allow_methods([Method::GET, Method::POST])
				.allow_headers(Any)
		)
		.with_state(pool);

	let port = env::var("SEARCH_PORT").unwrap_or_else(|_| "8000".to_string());
	let listener = TcpListener::bind(format!("0.0.0.0:{}", port)).await?;

	println!("Server running on port {}", port);
	axum::serve(listener, app).await?;

	Ok(())
}

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
	routing::{ get },
	Router,
};
use tower_http::cors::{ CorsLayer, Any };
use axum::response::Response;
use axum::http::{header};

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
	let query = params.get("q").ok_or(StatusCode::BAD_REQUEST)?;

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

	let vectors = vector_data["vectors"]
		.as_array()
		.ok_or_else(|| {
			error!("AI service response missing 'vectors' array field");
			StatusCode::INTERNAL_SERVER_ERROR
		})?
		[0].as_array()
		.ok_or_else(|| {
			error!("AI service response vectors[0] is not an array");
			StatusCode::INTERNAL_SERVER_ERROR
		})?
		.iter()
		.map(|v| v.as_f64().unwrap_or(0.0))
		.collect::<Vec<f64>>();

	let vector_string = format!(
		"[{}]",
		vectors
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
			   ag.matched_types_list, w.title, w.description, 
			   w.amount_of_buttons, w.id
		FROM aggregated_scores ag
		JOIN websites w ON ag.website = w.url
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
				"website_id": row.get::<i32, _>("id")
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
	let row: (String, String, Option<String>, i32, Option<chrono::NaiveDateTime>) = sqlx
		::query_as(
			"SELECT url, title, description, amount_of_buttons, scraped_at FROM websites WHERE scraped_at IS NOT NULL ORDER BY RANDOM() LIMIT 1"
		)
		.fetch_one(&pool).await
		.map_err(|e| {
			error!("Database error in random_website_handler: {}", e);
			StatusCode::INTERNAL_SERVER_ERROR
		})?;

	let url = &row.0;
	
	let button_rows = sqlx
		::query(
			"SELECT b.id, b.url as button_text, b.color_tag, w.url as found_url, br.links_to_url as links_to, b.color_average, b.scraped_at, b.alt, b.title 
			 FROM buttons b 
			 JOIN buttons_relations br ON b.id = br.button_id 
			 JOIN websites w ON br.website_id = w.id 
			 WHERE w.url = $1 
			 LIMIT 50"
		)
		.bind(url)
		.fetch_all(&pool).await
		.map_err(|e| {
			error!("Database error fetching buttons in random_website_handler: {}", e);
			StatusCode::INTERNAL_SERVER_ERROR
		})?;

	let buttons: Vec<Value> = button_rows
		.iter()
		.map(|row| {
			json!({
				"id": row.get::<i32, _>("id"),
				"button_text": row.get::<String, _>("button_text"),
				"color_tag": row.get::<Option<String>, _>("color_tag"),
				"found_url": row.get::<Option<String>, _>("found_url"),
				"links_to": row.get::<Option<String>, _>("links_to"),
				"color_average": row.get::<Option<String>, _>("color_average"),
				"scraped_at": row.get::<Option<chrono::NaiveDateTime>, _>("scraped_at"),
				"alt": row.get::<Option<String>, _>("alt"),
				"title": row.get::<Option<String>, _>("title")
			})
		})
		.collect();

	let result = json!({
		"website": {
			"url": row.0,
			"title": row.1,
			"description": row.2,
			"amount_of_buttons": row.3,
			"buttons": buttons,
			"scraped_at": row.4,
		}
	});

	Ok(Json(result))
}

async fn retrieve_all_buttons_handler(
	State(pool): State<PgPool>,
	Query(params): Query<HashMap<String, String>>
) -> Result<Json<Value>, StatusCode> {
	let page: usize = params
		.get("page")
		.and_then(|p| p.parse().ok())
		.unwrap_or(1);
	let limit: usize = params
		.get("pageSize")
		.and_then(|l| l.parse().ok())
		.unwrap_or(100);
	let color_filter = params.get("color").map(|c| c == "true").unwrap_or(false);

	let offset = (page - 1) * limit;

	if color_filter {
		let search_query = params.get("q").unwrap_or(&"".to_string()).to_string();
		let search_query = format!("%{}%", search_query);
		
		let count_query = "SELECT COUNT(*) FROM buttons WHERE color_tag ILIKE $1";

		let total_count: (i64,) = sqlx
			::query_as(count_query)
			.bind(&search_query)
			.fetch_one(&pool).await
			.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

		let query = "SELECT id, url as button_text, color_tag, '' as website_url, color_average, scraped_at, alt, title, content FROM buttons WHERE color_tag ILIKE $1 ORDER BY id LIMIT $2 OFFSET $3";

		let rows = sqlx
			::query(query)
			.bind(search_query)
			.bind(limit as i64)
			.bind(offset as i64)
			.fetch_all(&pool).await
			.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

		let buttons: Vec<Value> = rows
			.iter()
			.map(|row| {
				json!({
					"id": row.get::<i32, _>("id"),
					"button_text": row.get::<String, _>("button_text"),
					"color_tag": row.get::<Option<String>, _>("color_tag"),
					"website_url": row.get::<String, _>("website_url"),
					"color_average": row.get::<Option<String>, _>("color_average"),
					"scraped_at": row.get::<Option<chrono::NaiveDateTime>, _>("scraped_at"),
					"alt": row.get::<Option<String>, _>("alt"),
					"title": row.get::<Option<String>, _>("title"),
				})
			})
			.collect();

		let total_pages = ((total_count.0 as f64) / (limit as f64)).ceil() as usize;

		let response = json!({
			"buttons": buttons,
			"pagination": {
				"currentPage": page,
				"totalPages": total_pages,
				"totalButtons": total_count.0,
				"hasPreviousPage": page > 1,
				"hasNextPage": page < total_pages,
				"previousPage": if page > 1 { Some(page - 1) } else { None },
				"nextPage": if page < total_pages { Some(page + 1) } else { None }
			}
		});
		return Ok(Json(response));
	}

	if params.contains_key("q") {
		let search_query = params.get("q").unwrap();
		let search_query = format!("%{}%", search_query);
		
		let count_query = "SELECT COUNT(*) FROM buttons WHERE url ILIKE $1";

		let total_count: (i64,) = sqlx
			::query_as(count_query)
			.bind(&search_query)
			.fetch_one(&pool).await
			.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

		let query = "SELECT id, url as button_text, color_tag, '' as website_url, color_average, scraped_at, alt, title, content FROM buttons WHERE url ILIKE $1 ORDER BY id LIMIT $2 OFFSET $3";

		let rows = sqlx
			::query(query)
			.bind(search_query)
			.bind(limit as i64)
			.bind(offset as i64)
			.fetch_all(&pool).await
			.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

		let buttons: Vec<Value> = rows
			.iter()
			.map(|row| {
				json!({
				"id": row.get::<i32, _>("id"),
				"button_text": row.get::<String, _>("button_text"),
				"color_tag": row.get::<Option<String>, _>("color_tag"),
				"website_url": row.get::<String, _>("website_url"),
				"color_average": row.get::<Option<String>, _>("color_average"),
				"scraped_at": row.get::<Option<chrono::NaiveDateTime>, _>("scraped_at"),
				"alt": row.get::<Option<String>, _>("alt"),
				"title": row.get::<Option<String>, _>("title"),
			})
			})
			.collect();

		let total_pages = ((total_count.0 as f64) / (limit as f64)).ceil() as usize;

		let response =
			json!({
				"buttons": buttons,
				"pagination": {
					"currentPage": page,
					"totalPages": total_pages,
					"totalButtons": total_count.0,
					"hasPreviousPage": page > 1,
					"hasNextPage": page < total_pages,
					"previousPage": if page > 1 { Some(page - 1) } else { None },
					"nextPage": if page < total_pages { Some(page + 1) } else { None }
				}
			});
		return Ok(Json(response));
	}

	let total_count: (i64,) = sqlx
		::query_as("SELECT COUNT(*) FROM buttons")
		.fetch_one(&pool).await
		.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

	let query =
		"SELECT id, url as button_text, color_tag, '' as website_url, color_average, scraped_at, alt, title, content FROM buttons ORDER BY id LIMIT $1 OFFSET $2";

	let rows = sqlx
		::query(query)
		.bind(limit as i64)
		.bind(offset as i64)
		.fetch_all(&pool).await
		.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

	let buttons: Vec<Value> = rows
		.iter()
		.map(|row| {
			json!({
				"id": row.get::<i32, _>("id"),
				"button_text": row.get::<String, _>("button_text"),
				"color_tag": row.get::<Option<String>, _>("color_tag"),
				"website_url": row.get::<String, _>("website_url"),
				"color_average": row.get::<Option<String>, _>("color_average"),
				"scraped_at": row.get::<Option<chrono::NaiveDateTime>, _>("scraped_at"),
				"alt": row.get::<Option<String>, _>("alt"),
				"title": row.get::<Option<String>, _>("title"),
			})
		})
		.collect();

	let total_pages = ((total_count.0 as f64) / (limit as f64)).ceil() as usize;

	let response =
		json!({
			"buttons": buttons,
			"pagination": {
				"currentPage": page,
				"totalPages": total_pages,
				"totalButtons": total_count.0,
				"hasPreviousPage": page > 1,
				"hasNextPage": page < total_pages,
				"previousPage": if page > 1 { Some(page - 1) } else { None },
				"nextPage": if page < total_pages { Some(page + 1) } else { None }
			}
		});

	Ok(Json(response))
}

async fn check_indexed_handler(
	Query(params): Query<HashMap<String, String>>,
	State(pool): State<PgPool>
) -> Result<Json<Value>, StatusCode> {
	let mut website = params.get("url").ok_or(StatusCode::BAD_REQUEST)?.clone();
	if website.is_empty() {
		return Err(StatusCode::BAD_REQUEST);
	}
	if website.starts_with("http://") {
		website.replace_range(0..7, "");
	}
	if website.starts_with("https://") {
		website.replace_range(0..8, "");
	}
	if !website.ends_with('/') {
		website.push('/');
	}

	let row: (i64,) = sqlx
		::query_as(
			"SELECT COUNT(*) FROM websites_index WHERE website LIKE CONCAT('http://', $1) OR website LIKE CONCAT('https://', $1)"
		)
		.bind(website.clone())
		.fetch_one(&pool).await
		.map_err(|e| {
			error!("Database error in check_indexed_handler: {}", e);
			StatusCode::INTERNAL_SERVER_ERROR
		})?;

	let is_indexed = row.0 > 0;
	Ok(Json(json!({ "indexed": is_indexed })))
}

async fn single_button_handler(
	State(pool): State<PgPool>,
	Query(params): Query<HashMap<String, String>>
) -> Result<Response, StatusCode> {
	let button_id = params.get("buttonId").ok_or(StatusCode::BAD_REQUEST)?;
	let row: (i32, String, Option<String>, String, Option<String>, Option<chrono::NaiveDateTime>, Option<String>, Option<String>, Option<Vec<u8>>) = sqlx
		::query_as(
			"SELECT id, url as button_text, color_tag, '' as website_url, color_average, scraped_at, alt, title, content FROM buttons WHERE id = $1"
		)
		.bind(button_id.parse::<i32>().map_err(|_| StatusCode::BAD_REQUEST)?)
		.fetch_one(&pool).await
		.map_err(|_| StatusCode::NOT_FOUND)?;

	if let Some(content) = row.8.as_ref() {
		let content_type = "image/png";
		let filename = format!("button_{}.png", row.0);
		
		let body = axum::body::Body::from(content.clone());
		
		return Ok(Response::builder()
			.header(header::CONTENT_TYPE, content_type)
			.header(header::CONTENT_DISPOSITION, &format!("attachment; filename=\"{}\"", filename))
			.body(body)
			.unwrap());
	} else {
		return Err(StatusCode::NOT_FOUND);
	}
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
	dotenv().ok();

	tracing_subscriber::fmt::init();

	info!("Starting search server...");

	let pool: PgPool = PgPoolOptions::new()
		.max_connections(20)
		.connect(&env::var("DB_URL").expect("DB_URL must be set")).await?;

	let app = Router::new()
		.route("/stats", get(stats_handler))
		.route("/search", get(search_handler))
		.route("/randomWebsite", get(random_website_handler))
		.route("/retrieveAllButtons", get(retrieve_all_buttons_handler))
		.route("/checkIfIndexed", get(check_indexed_handler))
		.route("/retrieveButton", get(single_button_handler))
		.layer(
			CorsLayer::new()
				.allow_origin(Any)
				.allow_methods([Method::GET, Method::POST])
				.allow_headers(Any)
		)
		.with_state(pool);

	let port = env::var("API_PORT").unwrap_or_else(|_| "8000".to_string());
	let listener = TcpListener::bind(format!("0.0.0.0:{}", port)).await?;

	println!("Server running on port {}", port);
	axum::serve(listener, app).await?;

	Ok(())
}

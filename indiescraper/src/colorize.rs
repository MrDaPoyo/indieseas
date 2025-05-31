use image::{DynamicImage};
use std::collections::HashMap;

pub struct ColorAnalyzer {
    colors: HashMap<&'static str, [u8; 3]>,
}

#[derive(Debug)]
pub struct ColorAnalysis {
    pub tags: Vec<String>,
    pub hex_average: String,
}

impl ColorAnalyzer {
    pub fn new() -> Self {
        let mut colors = HashMap::new();
        colors.insert("red", [255, 0, 0]);
        colors.insert("blue", [0, 0, 255]);
        colors.insert("green", [0, 128, 0]);
        colors.insert("yellow", [255, 255, 0]);
        colors.insert("purple", [128, 0, 128]);
        colors.insert("orange", [255, 165, 0]);
        colors.insert("black", [0, 0, 0]);
        colors.insert("white", [255, 255, 255]);
        colors.insert("gray", [128, 128, 128]);
        colors.insert("pink", [255, 192, 203]);
        colors.insert("brown", [165, 42, 42]);

        Self { colors }
    }

    pub fn analyze_image(&self, image: &DynamicImage) -> ColorAnalysis {
        let rgb_image = image.to_rgb8();
        let mut color_counts: HashMap<&str, u32> = HashMap::new();
        let mut total_pixels = 0;
        let mut distinct_colors = std::collections::HashSet::new();
        let mut r_sum: u64 = 0;
        let mut g_sum: u64 = 0;
        let mut b_sum: u64 = 0;

        for pixel in rgb_image.pixels() {
            let [r, g, b] = pixel.0;
            distinct_colors.insert((r, g, b));
            total_pixels += 1;
            
            r_sum += r as u64;
            g_sum += g as u64;
            b_sum += b as u64;

            let closest_color = self.find_closest_color([r, g, b]);
            *color_counts.entry(closest_color).or_insert(0) += 1;
        }

        let avg_r = (r_sum / total_pixels as u64) as u8;
        let avg_g = (g_sum / total_pixels as u64) as u8;
        let avg_b = (b_sum / total_pixels as u64) as u8;
        let hex_average = format!("#{:02x}{:02x}{:02x}", avg_r, avg_g, avg_b);

        let tags = if self.is_black_and_white(&rgb_image) {
            vec!["b&w".to_string()]
        } else if distinct_colors.len() > total_pixels / 10 {
            vec!["rainbow".to_string()]
        } else {
            let mut sorted_colors: Vec<_> = color_counts.into_iter().collect();
            sorted_colors.sort_by(|a, b| b.1.cmp(&a.1));

            sorted_colors
                .into_iter()
                .take(3)
                .map(|(color, _)| color.to_string())
                .collect()
        };

        ColorAnalysis { tags, hex_average }
    }

    fn find_closest_color(&self, pixel: [u8; 3]) -> &'static str {
        let mut min_distance = f64::MAX;
        let mut closest_color = "black";

        for (name, color) in &self.colors {
            let distance = self.color_distance(pixel, *color);
            if distance < min_distance {
                min_distance = distance;
                closest_color = name;
            }
        }

        closest_color
    }

    fn color_distance(&self, a: [u8; 3], b: [u8; 3]) -> f64 {
        let dr = (a[0] as f64 - b[0] as f64).powi(2);
        let dg = (a[1] as f64 - b[1] as f64).powi(2);
        let db = (a[2] as f64 - b[2] as f64).powi(2);
        (dr + dg + db).sqrt()
    }

    fn is_black_and_white(&self, image: &image::RgbImage) -> bool {
        for pixel in image.pixels() {
            let [r, g, b] = pixel.0;
            if (r as i16 - g as i16).abs() > 10 || (r as i16 - b as i16).abs() > 10 {
                return false;
            }
        }
        true
    }
}
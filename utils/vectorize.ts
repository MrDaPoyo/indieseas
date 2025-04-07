import { AutoModel, AutoTokenizer, Tensor } from "@huggingface/transformers";

export async function createEmbedder(
	model_name = "minishlab/potion-base-8M",
	options = {
		model_type: "model2vec",
		model_revision: "main",
		tokenizer_revision: "main",
		device: navigator?.gpu ? "webgpu" : undefined, // use webgpu if available
		dtype: "fp32",
	}
) {
	const {
		model_type = "model2vec",
		model_revision = "main",
		tokenizer_revision = "main",
		device = typeof navigator !== 'undefined' && navigator?.gpu
			? "webgpu"
			: typeof process !== 'undefined' ? "cpu" : undefined,
		dtype = "fp32",
	} = options;

	const model = await AutoModel.from_pretrained(model_name, {
		config: { model_type },
		revision: model_revision,
		device,
		dtype,
	});

	const tokenizer = await AutoTokenizer.from_pretrained(model_name, {
		revision: tokenizer_revision,
	});

	/**
	 * Generate embeddings for the provided texts
	 * @param {string[]} texts - Array of texts to embed
	 * @returns {Promise<number[][]>} - Text embeddings
	 */
	return async function embed(texts) {
		// Tokenize inputs
		const { input_ids } = await tokenizer(texts, {
			add_special_tokens: false,
			return_tensor: false,
		});

		// Calculate offsets
		const offsets = [0];
		for (let i = 0; i < input_ids.length - 1; i++) {
			offsets.push(offsets[i] + input_ids[i].length);
		}

		// Create tensors and get embeddings from flattened input ids and offsets
		const flattened_input_ids = input_ids.flat();
		const model_inputs = {
			input_ids: new Tensor("int64", flattened_input_ids, [
				flattened_input_ids.length,
			]),
			offsets: new Tensor("int64", offsets, [offsets.length]),
		};

		const { embeddings } = await model(model_inputs);
		return embeddings.tolist();
	};
}

const embedder = await createEmbedder("minishlab/potion-base-32M", {
	device: "cpu"
});

Bun.serve({
	port: process.env.AI_API_PORT || 8888,
	routes: {
		"/": async () => {
			return new Response("IndieSeas AI API. Yucky, I know, but it is what it is.")
		},
		"/vectorize": async (req) => {
			if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
			const body = await req.json();
			let { text } = body;
			if (!text) return new Response("No texts provided", { status: 400 });
			// Ensure text is always an array
			const textArray = Array.isArray(text) ? text : [text];
			const embeddings = await embedder(textArray);
			return new Response(JSON.stringify({ vectors: embeddings }), {
				headers: { "Content-Type": "application/json" },
			});
		},
		"/test": async (req) => {
			return new Response(JSON.stringify({ vectors: await embedder(["Hello world", "This is a test"]) }), {
				headers: { "Content-Type": "application/json" },
			});
		},
	}
}
)
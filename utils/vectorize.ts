import { AutoModel, AutoTokenizer, Tensor } from "@huggingface/transformers";

/**
 * Creates an embedding function for generating vector representations of text
 * @param {string} model_name - HuggingFace model identifier
 * @param {object} options - Configuration options
 * @returns {Promise<Function>} - Async function that generates embeddings
 */
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
		device = navigator?.gpu ? "webgpu" : undefined, // use webgpu if available
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

export const embedder = await createEmbedder("minishlab/potion-base-32M", { device: "cpu" });

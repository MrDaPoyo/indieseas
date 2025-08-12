package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"

	"github.com/joho/godotenv"
)

// this is what LM Studio returns, (NORMALLY)
type ai_image_answer struct {
	ID      string `json:"id"`
	Object  string `json:"object"`
	Created int64  `json:"created"`
	Model   string `json:"model"`
	Choices []struct {
		Index        int         `json:"index"`
		Logprobs     interface{} `json:"logprobs"`
		FinishReason string      `json:"finish_reason"`
		Message      struct {
			Role             string `json:"role"`
			Content          string `json:"content"`
			ReasoningContent string `json:"reasoning_content"`
		} `json:"message"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage"`
	Stats             map[string]interface{} `json:"stats"`
	SystemFingerprint string                 `json:"system_fingerprint"`
}

func main() {
	godotenv.Load("../.env")
	IMAGE_PATH := os.Getenv("IMAGE_PATH")
	AI_API_URL := os.Getenv("AI_API_URL")
	PROMPT_FILE, prompt_err := os.ReadFile("./prompt.txt")
	if prompt_err != nil {
		log.Println("Error reading prompt file:", prompt_err)
		return
	}

	log.Println(IMAGE_PATH)

	var image_data, err = os.ReadFile(IMAGE_PATH)
	if err != nil {
		fmt.Println("Error reading image file:", err)
		return
	}

	var encoded_image_data string
	mimeType := http.DetectContentType(image_data)

	switch mimeType {
	case "image/jpeg":
		encoded_image_data += "data:image/jpeg;base64,"
	case "image/png":
		encoded_image_data += "data:image/png;base64,"
	}
	encoded_image_data += base64.StdEncoding.EncodeToString(image_data)

	reqBody := struct {
		Image string `json:"image"`
		Prompt string `json:"prompt"`
		Model string `json:"model,omitempty"`
	}{
		Image: encoded_image_data,
		Prompt: string(PROMPT_FILE),
		Model: "gemma-3-4b-it-qat",
	}
	payload, err := json.Marshal(reqBody)
	if err != nil {
		fmt.Println("Error marshaling request body:", err)
		return
	}

	resp, err := http.Post(AI_API_URL+"/v1/completions", "application/json", bytes.NewBuffer(payload))
	if err != nil {
		fmt.Println("Error sending request:", err)
		return
	}
	defer resp.Body.Close()

	respBodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		fmt.Println("Error reading response body:", err)
		return
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		fmt.Printf("Non-OK status %d, body: %s\n", resp.StatusCode, string(respBodyBytes))
		return
	}

	aiResponse := &ai_image_answer{}
	if err := json.Unmarshal(respBodyBytes, aiResponse); err != nil {
		fmt.Println("Error decoding JSON response:", err)
		fmt.Println("Raw response body:", string(respBodyBytes))
		return
	}

	var alt struct {
		Choices []struct {
			Text string `json:"text"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(respBodyBytes, &alt); err == nil && len(alt.Choices) > 0 && alt.Choices[0].Text != "" {
		fmt.Println("AI Response:", alt.Choices[0])
	}
}

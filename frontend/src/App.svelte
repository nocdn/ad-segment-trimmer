<script>
  import { Download, Forward } from "lucide-svelte";
  import Spinner from "./Spinner.svelte";

  let file = $state(null);
  let isDragging = $state(false);
  let uploading = $state(false);
  let downloadUrl = $state("");
  let errorMsg = $state("");
  let completed = $state(false);
  let rateLimited = $state(false);
  let duration = $state(0);
  let processingTime = $state(null);
  let showExample = $state(false);
  let originalFileName = $state("");
  let processingStage = $state("");

  // When a file is dragged over the dropzone, prevent default behavior
  function dragOver(event) {
    event.preventDefault();
    isDragging = true;
  }

  // When the dragged file leaves the dropzone
  function dragLeave(event) {
    event.preventDefault();
    isDragging = false;
  }

  // When a file is dropped in the dropzone
  function drop(event) {
    event.preventDefault();
    isDragging = false;
    if (event.dataTransfer.files.length) {
      file = event.dataTransfer.files[0];
      originalFileName = file.name; // Save the original filename
    }
  }

  // Handles changes from the hidden file input (click-to-select)
  function handleFileChange(event) {
    const files = event.target.files;
    if (files && files.length > 0) {
      file = files[0];
      originalFileName = file.name; // Save the original filename
      const url = URL.createObjectURL(file);
      const audio = new Audio(url);

      audio.addEventListener("loadedmetadata", () => {
        duration = audio.duration;
        console.log("Audio duration:", duration);
      });
    }
  }

  // Submit the file to the Flask API endpoint
  async function submitFile() {
    completed = false;
    if (!file) return;
    uploading = true;
    errorMsg = "";
    downloadUrl = "";
    processingTime = null;

    const startTime = performance.now();

    const formData = new FormData();
    formData.append("file", file);

    processingStage = "Uploading";
    setTimeout(() => {
      processingStage = "Transcribing";
    }, 2000);
    setTimeout(() => {
      processingStage = "Extracting ad segments";
    }, 9000);
    setTimeout(() => {
      processingStage = "Trimming audio";
    }, 13000);

    try {
      const response = await fetch("/process", {
        method: "POST",
        body: formData,
      });
      const endTime = performance.now();
      processingTime = ((endTime - startTime) / 1000).toFixed(2);
      console.log(`Processing completed in ${processingTime} seconds`);
      processingStage = null;
      if (response.status === 429) {
        rateLimited = true;
        file = null;
        return;
      }
      if (!response.ok) {
        errorMsg = `Error: ${response.status} ${response.statusText}`;
      } else {
        const blob = await response.blob();
        // Create an object URL for the blob to trigger download later
        downloadUrl = URL.createObjectURL(blob);
        file = null;
        completed = true;
      }
    } catch (err) {
      const endTime = performance.now();
      processingTime = ((endTime - startTime) / 1000).toFixed(2);
      console.log(`Processing failed after ${processingTime} seconds`);
      errorMsg = "Error: " + err;
    } finally {
      uploading = false;
    }
  }

  function calculateHumanReadableSize(size) {
    const units = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
    let unitIndex = 0;

    while (size >= 1024) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }
</script>

<main class="flex flex-col gap-4 items-center justify-center min-h-screen">
  <container class="w-sm flex flex-col gap-3">
    <p class="text-center font-semibold">Ad segment trimmer</p>
    <button
      class="w-sm h-36 rounded-2xl border-dotted font-mono p-4 grid place-content-center text-center cursor-pointer hover:bg-lightest-gray transition-colors
          {isDragging
        ? 'border-blue-500 border-3'
        : completed
          ? 'border-green-700 border-dotted border-2 bg-[#f7fffa]'
          : file
            ? 'border-blue-200 border-2'
            : 'border-gray-300 border-2'} 
          {file ? 'bg-lightest-blue' : ''}"
      aria-label="Dropzone for audio file"
      tabindex="0"
      ondragover={dragOver}
      ondragleave={dragLeave}
      ondrop={drop}
      onclick={() => document.getElementById("file-input").click()}
    >
      {#if file}
        <p class="font-semibold text-blue-900">{file.name}</p>
        <p class="text-sm text-gray-500">
          {calculateHumanReadableSize(file.size)} / 1GB
        </p>
      {:else if rateLimited}
        <p class="font-semibold text-orange-700">Rate limit reached</p>
        <p class="text-sm text-gray-500">try again later</p>
      {:else if !completed}
        <p class="text-sm">Drop an audio file here, or click to select one.</p>
      {:else}
        <p class="font-semibold mb-1 text-green-900">Advertisements removed!</p>
        <p>🎉</p>
      {/if}
      <input
        id="file-input"
        type="file"
        accept="audio/*"
        onchange={handleFileChange}
        style="display: none;"
      />
    </button>

    <buttons class="flex items-center justify-between">
      <!-- Submit button or Download button -->
      <button
        aria-label="Reset"
        class="rounded-xl border border-gray-200 px-4 py-3 w-fit font-medium cursor-pointer hover:bg-gray-50 group text-red-900"
        >Reset</button
      >

      <div
        class="rounded-xl border border-gray-200 px-4 py-3 w-fit font-medium cursor-pointer hover:bg-gray-50"
      >
        {#if downloadUrl}
          <!-- When processed, show a download button -->
          <a
            download={originalFileName
              ? originalFileName.replace(/\.[^/.]+$/, "_edited.mp3")
              : "edited.mp3"}
            href={downloadUrl}
          >
            <button
              class="cursor-pointer flex items-center gap-2.5 text-blue-800"
            >
              Download <Download size={16} strokeWidth={2.5} /></button
            >
          </a>
        {:else}
          <!-- Otherwise, a submit button -->
          <button
            onclick={submitFile}
            disabled={!file || uploading}
            class="cursor-pointer flex items-center gap-3"
          >
            {uploading ? "Processing..." : "Submit"}
            {#if !uploading}
              <Forward
                size={16}
                strokeWidth={2.25}
                class="group-hover:text-blue-500"
              />{/if}
          </button>
        {/if}
      </div>
    </buttons>
  </container>
  {#if errorMsg}
    <p style="color:red;">{errorMsg}</p>
  {/if}

  <section
    class="mt-2 w-full max-w-sm flex gap-2 items-center font-mono font-semibold {!completed &&
    processingStage
      ? 'opacity-80'
      : 'opacity-0'}"
  >
    <Spinner />
    <div>
      <!-- svelte-ignore a11y_invalid_attribute -->
      {#if processingStage === "Uploading"}
        <p class="motion-preset-blur-up motion-duration-300">Uploading</p>
      {:else if processingStage === "Transcribing"}
        <p class="motion-preset-blur-up motion-duration-300">Transcribing</p>
      {:else if processingStage === "Extracting ad segments"}
        <p class="motion-preset-blur-up motion-duration-300">
          Extracting ad segments
        </p>
      {:else if processingStage === "Trimming audio"}
        <p class="motion-preset-blur-up motion-duration-300">Trimming audio</p>
      {:else if processingStage === "Downloading"}
        <p class="motion-preset-blur-up motion-duration-300">Downloading</p>
      {/if}
    </div>
  </section>
</main>

"""Network retry utilities with exponential backoff."""
import time

def fetch_with_retry(do_request, max_retries=3, base_delay=0.5):
    """Call do_request(), retrying on failure with exponential backoff."""
    for attempt in range(max_retries):
        try:
            return do_request()
        except Exception:
            if attempt == max_retries - 1:
                raise
            time.sleep(base_delay * (2 ** attempt))

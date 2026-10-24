/* Handing the user a file.

   The desktop app used to navigate to the server's CSV endpoint. With no
   server on a phone the file has to be produced in the page, and inside an
   iOS home-screen app a download link has nowhere visible to land — so there
   the share sheet is offered instead, which can save to Files or hand the
   file to another app. */

/* iOS sets navigator.standalone when the page is running as a home-screen
   app. Nothing else does, so desktop behaviour is untouched. */
const isIosStandalone = () => window.navigator.standalone === true;

export async function offerFile(filename, text, type = 'text/csv') {
  const file = new File([text], filename, { type });

  if (isIosStandalone() && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    } catch (error) {
      // A cancelled share sheet is not a failure; fall through to the link.
      if (error.name !== 'AbortError') throw error;
      return 'cancelled';
    }
  }

  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  // Revoked on a later turn of the event loop: Safari needs the object URL to
  // outlive the click that started the download.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'downloaded';
}

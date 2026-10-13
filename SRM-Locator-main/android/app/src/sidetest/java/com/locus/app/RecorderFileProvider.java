package com.locus.app;

import androidx.core.content.FileProvider;

/**
 * A FileProvider of its own for the walk recordings (LOCUS Test only), so it does not merge
 * with the main one in AndroidManifest.xml, which serves the update APKs.
 */
public class RecorderFileProvider extends FileProvider {
}

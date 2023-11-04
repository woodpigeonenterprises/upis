import path from "path";
import HtmlWebpackPlugin from "html-webpack-plugin";

export default {
  mode: "development",

  entry: [path.resolve('./ts/index.ts')],

  output: {
    path: path.resolve('./dist'),
    filename: 'bundle.js'
  },

  plugins: [
    new HtmlWebpackPlugin({
      title: 'UPIS',
      template: path.resolve('./html/index.html')
    })
  ],

  module: {
    rules: [
      {
        test: /\.ts?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },

  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
  },

	devtool: "inline-source-map",

  devServer: {
		port: 8081,
			server: {
				type: 'https',
				options: {
					ca: './certs/woodpigeon-ca.crt',
					cert: './certs/localhost.crt',
					key: './certs/localhost.key',
				}
			}
  }
};

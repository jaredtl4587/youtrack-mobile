var React = require('react-native');
var {
    StyleSheet,
    Text,
    View,
    TouchableHighlight
    } = React;

let issueListStyles = require('../issue-list/issue-list.styles');

class SingeIssueView extends React.Component {

    _renderHeader() {
        return (
            <View style={issueListStyles.headerContainer}>
                <TouchableHighlight
                    underlayColor="#FFF"
                    style={issueListStyles.logOut}
                    onPress={() => this.props.onBack()}>
                    <Text style={issueListStyles.logOut__text}>List</Text>
                </TouchableHighlight>

                <Text style={styles.headerText}>{this.props.issueId}</Text>
            </View>
        )
    }

    render() {
        return (
            <View style={styles.container}>
                {this._renderHeader()}
                <Text>
                    {this.props.issueId}
                </Text>
            </View>
        );
    }
}

var styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F5FCFF'
    },
    headerText: {
        top: 11,
        left: 145
    }
});

module.exports = SingeIssueView;